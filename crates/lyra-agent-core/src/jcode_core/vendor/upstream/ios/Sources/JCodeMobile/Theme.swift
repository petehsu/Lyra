import SwiftUI

enum JC {
    // MARK: - Colors

    enum Colors {
        static let background = Color.black
        static let surface = Color(red: 0.03, green: 0.03, blue: 0.06)
        static let surfaceElevated = Color(red: 0.07, green: 0.07, blue: 0.10)
        static let surfaceHover = Color(red: 0.11, green: 0.11, blue: 0.14)

        static let border = Color.white.opacity(0.04)
        static let borderSubtle = Color.white.opacity(0.03)
        static let borderFocused = Color(red: 0.71, green: 0.49, blue: 1.0).opacity(0.4)

        static let accent = Color(red: 0.71, green: 0.49, blue: 1.0)
        static let accentDim = Color(red: 0.71, green: 0.49, blue: 1.0).opacity(0.12)
        static let accentGlow = Color(red: 0.71, green: 0.49, blue: 1.0).opacity(0.3)

        static let blue = Color(red: 0.30, green: 0.62, blue: 1.0)
        static let green = Color(red: 0.0, green: 0.90, blue: 0.46)
        static let pink = Color(red: 1.0, green: 0.36, blue: 0.67)
        static let cyan = Color(red: 0.0, green: 0.90, blue: 1.0)
        static let amber = Color(red: 1.0, green: 0.67, blue: 0.0)
        static let red = Color(red: 1.0, green: 0.24, blue: 0.35)

        static let textPrimary = Color.white.opacity(0.92)
        static let textSecondary = Color.white.opacity(0.45)
        static let textTertiary = Color.white.opacity(0.22)
        static let textOnAccent = Color.black

        static let userText = blue
        static let aiText = Color.white.opacity(0.86)
        static let systemText = pink.opacity(0.7)
        static let toolText = Color.white.opacity(0.22)

        static let userBubble = Color(red: 0.30, green: 0.62, blue: 1.0).opacity(0.10)
        static let assistantBubble = Color(red: 0.07, green: 0.07, blue: 0.10)
        static let systemBubble = Color(red: 1.0, green: 0.36, blue: 0.67).opacity(0.08)

        static let statusOnline = green
        static let statusConnecting = amber
        static let statusOffline = red

        static let toolStreaming = amber
        static let toolRunning = cyan
        static let toolDone = green
        static let toolFailed = red

        static let codeBackground = Color(red: 0.04, green: 0.04, blue: 0.06)
        static let codeBorder = Color.white.opacity(0.04)

        static let destructive = red
    }

    // MARK: - Typography

    enum Fonts {
        static let largeTitle = Font.system(size: 28, weight: .bold, design: .rounded)
        static let title = Font.system(size: 22, weight: .bold, design: .rounded)
        static let title2 = Font.system(size: 20, weight: .semibold, design: .rounded)
        static let headline = Font.system(size: 17, weight: .semibold)
        static let body = Font.system(size: 15, weight: .regular)
        static let callout = Font.system(size: 14, weight: .regular)
        static let caption = Font.system(size: 12, weight: .medium)
        static let caption2 = Font.system(size: 11, weight: .regular)

        static let mono = Font.system(size: 13, weight: .regular, design: .monospaced)
        static let monoSmall = Font.system(size: 11, weight: .regular, design: .monospaced)
        static let monoCaption = Font.system(size: 10, weight: .regular, design: .monospaced)

        static let prompt = Font.system(size: 16, weight: .medium, design: .monospaced)

        static let stream = Font.system(size: 14, weight: .regular)
        static let streamMono = Font.system(size: 12, weight: .regular, design: .monospaced)
        static let streamSmall = Font.system(size: 11, weight: .regular, design: .monospaced)
    }

    // MARK: - Spacing

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let xxxl: CGFloat = 48
    }

    // MARK: - Radii

    enum Radius {
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
        static let full: CGFloat = 100
    }

    // MARK: - Animations

    enum Animation {
        static let quick = SwiftUI.Animation.easeOut(duration: 0.15)
        static let standard = SwiftUI.Animation.easeInOut(duration: 0.25)
        static let smooth = SwiftUI.Animation.spring(response: 0.35, dampingFraction: 0.85)
        static let bounce = SwiftUI.Animation.spring(response: 0.4, dampingFraction: 0.7)
        static let slow = SwiftUI.Animation.easeInOut(duration: 0.5)
    }
}

// MARK: - Reusable View Modifiers

struct GlassCard: ViewModifier {
    var padding: CGFloat = JC.Spacing.lg

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(JC.Colors.surface)
            .clipShape(RoundedRectangle(cornerRadius: JC.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: JC.Radius.md, style: .continuous)
                    .stroke(JC.Colors.border, lineWidth: 1)
            )
    }
}

struct AccentButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(JC.Fonts.headline)
            .foregroundStyle(JC.Colors.textOnAccent)
            .padding(.horizontal, JC.Spacing.xl)
            .padding(.vertical, JC.Spacing.md)
            .background(JC.Colors.accent)
            .clipShape(RoundedRectangle(cornerRadius: JC.Radius.md, style: .continuous))
            .shadow(color: JC.Colors.accentGlow, radius: 12, y: 4)
            .scaleEffect(configuration.isPressed ? 0.96 : 1.0)
            .animation(JC.Animation.quick, value: configuration.isPressed)
    }
}

struct GhostButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(JC.Fonts.callout)
            .foregroundStyle(JC.Colors.textSecondary)
            .padding(.horizontal, JC.Spacing.lg)
            .padding(.vertical, JC.Spacing.sm)
            .background(JC.Colors.surfaceElevated)
            .clipShape(RoundedRectangle(cornerRadius: JC.Radius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: JC.Radius.sm, style: .continuous)
                    .stroke(JC.Colors.border, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.96 : 1.0)
            .animation(JC.Animation.quick, value: configuration.isPressed)
    }
}

struct PillBadge: View {
    let text: String
    var color: Color = JC.Colors.accent

    var body: some View {
        Text(text)
            .font(JC.Fonts.monoCaption)
            .foregroundStyle(color)
            .padding(.horizontal, JC.Spacing.sm)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}

extension View {
    func glassCard(padding: CGFloat = JC.Spacing.lg) -> some View {
        modifier(GlassCard(padding: padding))
    }
}

// MARK: - Status Dot

struct StatusDot: View {
    let color: Color
    var animated: Bool = false

    @State private var isPulsing = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .shadow(color: color.opacity(0.6), radius: 6)
            .overlay(
                Circle()
                    .stroke(color.opacity(0.4), lineWidth: 2)
                    .scaleEffect(isPulsing ? 1.8 : 1.0)
                    .opacity(isPulsing ? 0 : 1)
            )
            .onAppear {
                guard animated else { return }
                withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: false)) {
                    isPulsing = true
                }
            }
    }
}
