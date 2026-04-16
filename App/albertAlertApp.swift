import SwiftUI

@main
struct albertAlertApp: App {
    @StateObject private var viewModel: AlertFeedViewModel

    init() {
        let configuration = ThreatFeedConfigurationLoader.load()
        let service = CompositeAlertFeedService(
            configuration: configuration,
            fallbackService: MockAlertFeedService()
        )
        let notificationManager = AlertNotificationManager()
        let summaryService: AlertSummaryService

        if
            let summaryConfiguration = AIServiceConfigurationLoader.load(),
            let endpoint = URL(string: summaryConfiguration.summaryEndpoint)
        {
            summaryService = RemoteAlertSummaryService(endpoint: endpoint)
        } else {
            summaryService = MockAlertSummaryService()
        }

        _viewModel = StateObject(
            wrappedValue: AlertFeedViewModel(
                service: service,
                notificationManager: notificationManager,
                summaryService: summaryService
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(viewModel)
        }
    }
}
