// Starts, updates and ends the trip Live Activity for the web app (public/js/native.js →
// Capacitor plugin "LiveActivity"). Registered in MainViewController. iOS 16.2 or later;
// on older iPhones every call answers { available: false } and nothing is shown.
import ActivityKit
import Capacitor
import Foundation

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            call.resolve(["available": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["available": false])
        }
    }

    /// { tripId, driverName, plate, vehicle, service, status, title, subtitle, etaMinutes? }  (plate is in the live state too)
    /// Starts the activity for this trip (or updates it if it's already running). Its push token
    /// arrives later through the "pushToken" event, for the server to send updates.
    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(["available": false]); return }
        guard let tripId = call.getInt("tripId") else { call.reject("tripId is required"); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.resolve(["available": false]); return }
        let state = Self.contentState(call)
        if let running = Activity<FlytteTripAttributes>.activities.first(where: { $0.attributes.tripId == tripId }) {
            Task {
                await running.update(ActivityContent(state: state, staleDate: nil))
                call.resolve(["available": true, "started": false])
            }
            return
        }
        // One trip at a time: close anything left from an earlier trip.
        for old in Activity<FlytteTripAttributes>.activities {
            Task { await old.end(nil, dismissalPolicy: .immediate) }
        }
        let attributes = FlytteTripAttributes(
            tripId: tripId,
            driverName: call.getString("driverName") ?? "",
            plate: call.getString("plate") ?? "",
            vehicle: call.getString("vehicle") ?? "",
            service: call.getString("service") ?? ""
        )
        do {
            let activity = try Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil), pushType: .token)
            Task { [weak self] in
                for await data in activity.pushTokenUpdates {
                    let token = data.map { String(format: "%02x", $0) }.joined()
                    self?.notifyListeners("pushToken", data: ["tripId": tripId, "token": token])
                }
            }
            call.resolve(["available": true, "started": true])
        } catch {
            call.reject("The trip couldn’t be shown on the lock screen: \(error.localizedDescription)")
        }
    }

    /// { tripId, status, title, subtitle, plate, etaMinutes? }
    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(["available": false]); return }
        guard let tripId = call.getInt("tripId"),
              let running = Activity<FlytteTripAttributes>.activities.first(where: { $0.attributes.tripId == tripId }) else {
            call.resolve(["updated": false]); return
        }
        let state = Self.contentState(call)
        Task {
            await running.update(ActivityContent(state: state, staleDate: nil))
            call.resolve(["updated": true])
        }
    }

    /// { tripId?, status?, title?, subtitle? } — ends that trip's activity (or all). With a final
    /// title it stays on the lock screen a few minutes ("You've arrived"), otherwise it goes now.
    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(["available": false]); return }
        let tripId = call.getInt("tripId")
        let closing: ActivityContent<FlytteTripAttributes.ContentState>? = call.getString("title") != nil
            ? ActivityContent(state: Self.contentState(call), staleDate: nil) : nil
        let policy: ActivityUIDismissalPolicy = closing != nil ? .after(Date().addingTimeInterval(5 * 60)) : .immediate
        let targets = Activity<FlytteTripAttributes>.activities.filter { tripId == nil || $0.attributes.tripId == tripId }
        Task {
            for activity in targets { await activity.end(closing, dismissalPolicy: policy) }
            call.resolve(["ended": targets.count])
        }
    }

    @available(iOS 16.1, *)
    private static func contentState(_ call: CAPPluginCall) -> FlytteTripAttributes.ContentState {
        FlytteTripAttributes.ContentState(
            status: call.getString("status") ?? "accepted",
            title: call.getString("title") ?? "Your Flytte trip",
            subtitle: call.getString("subtitle") ?? "",
            plate: call.getString("plate") ?? "",
            etaMinutes: call.getInt("etaMinutes")
        )
    }
}
