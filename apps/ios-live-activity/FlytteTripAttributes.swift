// The Live Activity for a Flytte trip: shared by the app (which starts it) and the widget
// extension (which draws it). The server updates it by push (src/liveactivity.js), so the
// ContentState field names here must match the "content-state" JSON it sends.
import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct FlytteTripAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// searching | accepted | near | arrived | in_progress | completed | cancelled
        var status: String
        /// e.g. "Moses is on the way"
        var title: String
        /// e.g. "White Toyota Corolla · Pickup: Kampala Road"
        var subtitle: String
        /// The current driver's number plate ("" while finding another driver).
        var plate: String
        /// Minutes until the driver reaches the pickup, while they're on the way.
        var etaMinutes: Int?
    }

    var tripId: Int
    var driverName: String
    var plate: String
    var vehicle: String
    var service: String
}
