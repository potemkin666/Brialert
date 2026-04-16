import Foundation

struct MonitoredDocumentState: Codable, Hashable {
    let etag: String?
    let lastModified: String?
}

final class MonitoredDocumentStateStore {
    private let keyPrefix = "albertalert.monitoredDocumentState."

    func load(for sourceID: String) -> MonitoredDocumentState? {
        let key = keyPrefix + sourceID
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(MonitoredDocumentState.self, from: data)
    }

    func save(_ state: MonitoredDocumentState, for sourceID: String) {
        let key = keyPrefix + sourceID
        guard let data = try? JSONEncoder().encode(state) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}
