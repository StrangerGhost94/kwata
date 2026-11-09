// The Flytte F (logo concept 01), drawn from the same vector paths as the app icon.
// Generated from tools/brand.js; the box is 76.82 × 145.05.
import SwiftUI

struct FlytteF: Shape {
    func path(in r: CGRect) -> Path {
        let sx = r.width / 76.82, sy = r.height / 145.05
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: r.minX + x * sx, y: r.minY + y * sy) }
        var f = Path()
        f.move(to: p(76.82, 0.0))
        f.addLine(to: p(76.82, 21.29))
        f.addCurve(to: p(68.31, 36.03), control1: p(76.82, 27.37), control2: p(73.58, 32.99))
        f.addLine(to: p(26.95, 59.91))
        f.addCurve(to: p(0.0, 86.42), control1: p(23.05, 62.16), control2: p(7.5, 68.5))
        f.addLine(to: p(0.0, 57.23))
        f.addCurve(to: p(11.15, 37.92), control1: p(0.0, 49.27), control2: p(4.25, 41.9))
        f.addLine(to: p(26.95, 28.8))
        f.closeSubpath()
        f.move(to: p(68.7, 52.48))
        f.addLine(to: p(68.7, 72.14))
        f.addCurve(to: p(58.78, 89.33), control1: p(68.7, 79.23), control2: p(64.92, 85.78))
        f.addLine(to: p(38.18, 101.22))
        f.addCurve(to: p(26.95, 120.68), control1: p(31.23, 105.24), control2: p(26.95, 112.65))
        f.addLine(to: p(26.95, 145.05))
        f.addLine(to: p(0.0, 145.05))
        f.addLine(to: p(0.0, 116.04))
        f.addCurve(to: p(20.69, 80.2), control1: p(0.0, 101.26), control2: p(7.89, 87.6))
        f.addLine(to: p(26.95, 76.59))
        f.closeSubpath()
        return f
    }
}
