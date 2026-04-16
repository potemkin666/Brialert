import Foundation

final class LocalAnalystStore {
    private let watchlistKey = "albertalert.watchlistIDs"
    private let notesKey = "albertalert.analystNotes"

    func loadWatchlistIDs() -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: watchlistKey) ?? [])
    }

    func saveWatchlistIDs(_ ids: Set<String>) {
        UserDefaults.standard.set(Array(ids), forKey: watchlistKey)
    }

    func loadNotes() -> [AnalystNote] {
        guard
            let data = UserDefaults.standard.data(forKey: notesKey),
            let notes = try? JSONDecoder().decode([AnalystNote].self, from: data)
        else {
            return Self.defaultNotes
        }

        return notes
    }

    func saveNotes(_ notes: [AnalystNote]) {
        guard let data = try? JSONEncoder().encode(notes) else { return }
        UserDefaults.standard.set(data, forKey: notesKey)
    }

    static let defaultNotes: [AnalystNote] = [
        AnalystNote(
            id: UUID(),
            title: "Morning posture",
            body: "Maintain focus on transport hubs, symbolic sites, and fast-moving public order environments with terrorism indicators.",
            relatedAlertID: nil,
            createdAt: .now.addingTimeInterval(-4_500),
            author: "Brian"
        ),
        AnalystNote(
            id: UUID(),
            title: "Cross-border watch",
            body: "Track whether any developing European incidents show common method, travel pathway, or propaganda overlap with UK activity.",
            relatedAlertID: nil,
            createdAt: .now.addingTimeInterval(-2_000),
            author: "Brian"
        )
    ]
}
