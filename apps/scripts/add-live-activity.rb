# Adds the trip Live Activity to the rider app's Xcode project (apps/rider/ios):
#   - the FlytteTripWidget widget extension (lock screen + Dynamic Island), iOS 16.2+
#   - LiveActivityPlugin + MainViewController in the app (the web app starts/updates/ends it)
#   - FlytteTripAttributes.swift compiled into both, so they agree on the data
# Sources live in apps/ios-live-activity/. Safe to run again. Needs the xcodeproj gem
# (gem install xcodeproj; it comes with CocoaPods). Run by `npm run sync`, or:
#   ruby scripts/add-live-activity.rb
require 'fileutils'
require 'xcodeproj'

ROOT = File.expand_path('..', __dir__)
SRC = File.join(ROOT, 'ios-live-activity')
IOS = File.join(ROOT, 'rider', 'ios', 'App')
abort "No iOS project at #{IOS} (run npx cap add ios in apps/rider first)" unless Dir.exist?(IOS)

# ---- files
app_dir = File.join(IOS, 'App', 'LiveActivity')
ext_dir = File.join(IOS, 'FlytteTripWidget')
FileUtils.mkdir_p([app_dir, ext_dir])
%w[FlytteTripAttributes.swift LiveActivityPlugin.swift MainViewController.swift].each { |f| FileUtils.cp(File.join(SRC, f), app_dir) }
%w[FlytteF.swift FlytteTripLiveActivity.swift Info.plist].each { |f| FileUtils.cp(File.join(SRC, f), ext_dir) }

project = Xcodeproj::Project.open(File.join(IOS, 'App.xcodeproj'))
app = project.targets.find { |t| t.name == 'App' } or abort 'App target not found'
app_group = project.main_group.find_subpath('App', false) or abort 'App group not found'

def file_ref(group, path)
  group.files.find { |f| f.path == path } || group.new_reference(path)
end

# ---- app side: plugin, view controller, shared attributes
la_group = app_group.find_subpath('LiveActivity', true)
la_group.set_source_tree('<group>')
la_group.set_path('LiveActivity')
shared = nil
%w[FlytteTripAttributes.swift LiveActivityPlugin.swift MainViewController.swift].each do |f|
  ref = file_ref(la_group, f)
  shared = ref if f == 'FlytteTripAttributes.swift'
  app.source_build_phase.add_file_reference(ref, true)
end

# ---- the widget extension
ext = project.targets.find { |t| t.name == 'FlytteTripWidget' }
unless ext
  ext = project.new_target(:app_extension, 'FlytteTripWidget', :ios, '16.2', nil, :swift)
end
ext_group = project.main_group.find_subpath('FlytteTripWidget', true)
ext_group.set_source_tree('<group>')
ext_group.set_path('FlytteTripWidget')
%w[FlytteF.swift FlytteTripLiveActivity.swift].each { |f| ext.source_build_phase.add_file_reference(file_ref(ext_group, f), true) }
file_ref(ext_group, 'Info.plist')
ext.source_build_phase.add_file_reference(shared, true)
ext.add_system_framework(%w[WidgetKit SwiftUI ActivityKit])

app_settings = app.build_configurations.first.build_settings
app_id = app_settings['PRODUCT_BUNDLE_IDENTIFIER'] || 'co.flytte.rider'
ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{app_id}.FlytteTripWidget"
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'FlytteTripWidget/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
  s['TARGETED_DEVICE_FAMILY'] = '1'
  s['SWIFT_VERSION'] = app_settings['SWIFT_VERSION'] || '5.0'
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION'] || '1.0.0'
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION'] || '1'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SKIP_INSTALL'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['SWIFT_EMIT_LOC_STRINGS'] = 'YES'
end

# Build the widget with the app and put it inside it.
app.add_dependency(ext) unless app.dependencies.any? { |d| d.target == ext }
embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' }
unless embed
  embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
  embed.dst_subfolder_spec = '13'   # PlugIns
end
unless embed.files_references.include?(ext.product_reference)
  bf = embed.add_file_reference(ext.product_reference, true)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end

project.save
puts '  Live Activity: FlytteTripWidget target and LiveActivityPlugin in rider/ios'

# ---- the main screen registers the plugin (MainViewController instead of Capacitor's own)
sb = File.join(IOS, 'App', 'Base.lproj', 'Main.storyboard')
s = File.read(sb)
t = s.sub('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="MainViewController" customModule="App" customModuleProvider="target"')
if t != s
  File.write(sb, t)
  puts '  updated rider/ios/App/App/Base.lproj/Main.storyboard'
end
