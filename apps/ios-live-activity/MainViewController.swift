// The rider app's main screen: Capacitor's own, plus the app's local plugins.
// Main.storyboard points at this class (set by apps/scripts/add-live-activity.rb).
import Capacitor
import UIKit

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
