import Foundation
import UserNotifications

protocol AlertNotificationManaging {
    func requestAuthorizationIfNeeded() async
    func scheduleNotifications(for alerts: [TerrorAlert]) async
}

final class AlertNotificationManager: AlertNotificationManaging {
    private let center = UNUserNotificationCenter.current()
    private let seenKey = "albertalert.seenAlertIDs"

    func requestAuthorizationIfNeeded() async {
        do {
            _ = try await center.requestAuthorization(options: [.alert, .badge, .sound])
        } catch {
        }
    }

    func scheduleNotifications(for alerts: [TerrorAlert]) async {
        let seenIDs = Set(UserDefaults.standard.stringArray(forKey: seenKey) ?? [])
        let newUrgentAlerts = alerts.filter {
            $0.requiresImmediateAttention &&
            $0.verificationState != .unconfirmed &&
            !seenIDs.contains($0.id)
        }

        for alert in newUrgentAlerts.prefix(3) {
            let content = UNMutableNotificationContent()
            content.title = "AlbertAlert Priority Incident"
            content.body = "\(alert.title) in \(alert.location)"
            content.sound = .default

            let request = UNNotificationRequest(
                identifier: alert.id,
                content: content,
                trigger: nil
            )

            do {
                try await center.add(request)
            } catch {
            }
        }

        let updatedSeen = Array(seenIDs.union(newUrgentAlerts.map(\.id)))
        UserDefaults.standard.set(updatedSeen, forKey: seenKey)
    }
}
