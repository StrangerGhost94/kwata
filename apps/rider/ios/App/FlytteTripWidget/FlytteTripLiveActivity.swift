// Flytte's trip Live Activity: the lock screen and the Dynamic Island while a driver is on the way,
// at the pickup, and during the ride. Lives in the FlytteTripWidget extension of the rider app.
import ActivityKit
import SwiftUI
import WidgetKit

private let teal = Color(red: 7 / 255, green: 59 / 255, blue: 66 / 255)
private let lagoon = Color(red: 14 / 255, green: 110 / 255, blue: 115 / 255)
private let gold = Color(red: 242 / 255, green: 181 / 255, blue: 68 / 255)
private let mist = Color(red: 207 / 255, green: 227 / 255, blue: 227 / 255)

@main
struct FlytteTripWidgetBundle: WidgetBundle {
    var body: some Widget {
        FlytteTripLiveActivity()
    }
}

struct FlytteTripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FlytteTripAttributes.self) { context in
            TripLockScreen(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(teal)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    FlytteF().fill(gold).frame(width: 16, height: 30).padding(.leading, 6).padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Eta(state: context.state, size: 20).padding(.trailing, 6).padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.title).font(.headline).foregroundColor(.white).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Plate(text: context.state.plate)
                            Text(context.state.subtitle).font(.subheadline).foregroundColor(mist).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        Steps(status: context.state.status)
                    }
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                FlytteF().fill(gold).frame(width: 9, height: 17).padding(.leading, 2)
            } compactTrailing: {
                Text(shortStatus(context.state)).font(.caption2.weight(.bold)).foregroundColor(gold)
            } minimal: {
                FlytteF().fill(gold).frame(width: 9, height: 17)
            }
            .keylineTint(gold)
            .widgetURL(URL(string: "https://flytte.co/"))
        }
    }
}

// What fits next to the camera: the minutes while the driver is coming, else a word.
@available(iOS 16.1, *)
private func shortStatus(_ s: FlytteTripAttributes.ContentState) -> String {
    switch s.status {
    case "accepted", "near": return s.etaMinutes.map { "\($0) min" } ?? "On way"
    case "arrived": return "Here"
    case "in_progress": return "On trip"
    case "completed": return "Done"
    case "searching": return "Finding"
    default: return ""
    }
}

@available(iOS 16.1, *)
private struct TripLockScreen: View {
    let attributes: FlytteTripAttributes
    let state: FlytteTripAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                FlytteF().fill(gold).frame(width: 18, height: 34)
                VStack(alignment: .leading, spacing: 3) {
                    Text(state.title).font(.headline).foregroundColor(.white).lineLimit(1)
                    Text(state.subtitle).font(.subheadline).foregroundColor(mist).lineLimit(2)
                }
                Spacer(minLength: 8)
                Eta(state: state, size: 26)
            }
            HStack(spacing: 10) {
                Plate(text: state.plate)
                Steps(status: state.status)
            }
        }
        .padding(16)
    }
}

@available(iOS 16.1, *)
private struct Eta: View {
    let state: FlytteTripAttributes.ContentState
    let size: CGFloat

    var body: some View {
        if ["accepted", "near"].contains(state.status), let m = state.etaMinutes {
            VStack(alignment: .trailing, spacing: 0) {
                Text("\(m)").font(.system(size: size, weight: .bold, design: .rounded)).foregroundColor(gold)
                Text("min").font(.caption2.weight(.semibold)).foregroundColor(mist)
            }
        } else if state.status == "arrived" {
            Text("Here").font(.system(size: size * 0.7, weight: .bold, design: .rounded)).foregroundColor(gold)
        }
    }
}

private struct Plate: View {
    let text: String

    var body: some View {
        if !text.isEmpty {
            Text(text)
                .font(.subheadline.weight(.heavy))
                .foregroundColor(teal)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(gold)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
    }
}

// On the way → at the pickup → on the trip.
private struct Steps: View {
    let status: String

    private var reached: Int {
        switch status {
        case "accepted", "near": return 1
        case "arrived": return 2
        case "in_progress", "completed": return 3
        default: return 0
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(1...3, id: \.self) { i in
                Capsule().fill(i <= reached ? gold : lagoon).frame(height: 5)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(["Finding a driver", "Driver on the way", "Driver at the pickup", "On the trip"][reached])
    }
}
