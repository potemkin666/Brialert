import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var viewModel: AlertFeedViewModel

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.03, green: 0.04, blue: 0.08),
                        Color(red: 0.11, green: 0.13, blue: 0.18),
                        Color(red: 0.23, green: 0.12, blue: 0.10)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 20) {
                        header
                        BulldogBadgeView()
                        filterBar

                        if let priorityAlert = viewModel.priorityAlert {
                            priorityPanel(for: priorityAlert)
                        }

                        Text("Live Incident Feed")
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)

                        LazyVStack(spacing: 14) {
                            ForEach(viewModel.filteredAlerts) { alert in
                                AlertCardView(
                                    alert: alert,
                                    isWatched: viewModel.isWatched(alert),
                                    onToggleWatchlist: {
                                        viewModel.toggleWatchlist(for: alert)
                                    },
                                    onOpenDetail: {
                                        Task {
                                            await viewModel.openDetail(for: alert)
                                        }
                                    }
                                )
                            }
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 10)
                    .padding(.bottom, 28)
                }
            }
            .navigationBarHidden(true)
        }
        .task {
            if viewModel.alerts.isEmpty {
                await viewModel.loadAlerts()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("albertalert")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.white.opacity(0.62))
                .textCase(.uppercase)

            Text("F.O.C")
                .font(.system(size: 40, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)

            Text("Instant terrorism monitoring across the UK and Europe with a live feed, map posture, watchlists, notes, and urgent push alerts.")
                .font(.callout)
                .foregroundStyle(Color.white.opacity(0.76))

            HStack {
                statusChip(title: "Push Ready", systemImage: "bell.badge.fill", color: .red)
                statusChip(title: viewModel.selectedRegion.rawValue, systemImage: "location", color: .orange)

                if let lastUpdated = viewModel.lastUpdated {
                    statusChip(
                        title: "Updated \(lastUpdated.formatted(date: .omitted, time: .shortened))",
                        systemImage: "clock",
                        color: .teal
                    )
                }
            }
        }
        .padding(22)
        .background(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(Color.white.opacity(0.08))
        )
    }

    private var filterBar: some View {
        HStack(spacing: 10) {
            ForEach(TerrorAlert.Region.allCases) { region in
                Button {
                    viewModel.selectedRegion = region
                } label: {
                    Text(region.rawValue)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(viewModel.selectedRegion == region ? .black : .white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(
                            Capsule()
                                .fill(viewModel.selectedRegion == region ? Color.white : Color.white.opacity(0.10))
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func priorityPanel(for alert: TerrorAlert) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Priority Incident", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white.opacity(0.72))
                    .textCase(.uppercase)

                Spacer()

                if viewModel.isLoading {
                    ProgressView()
                        .tint(.white)
                }
            }

            Text(alert.title)
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(.white)

            Text("\(alert.location) | \(alert.verificationState.rawValue)")
                .font(.headline)
                .foregroundStyle(Color.white.opacity(0.74))

            Text(alert.summary)
                .font(.body)
                .foregroundStyle(Color.white.opacity(0.88))
                .lineSpacing(4)

            HStack {
                Text(alert.sourceLabel)
                Spacer()
                Text(alert.reportedAt.formatted(date: .omitted, time: .shortened))
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.white.opacity(0.68))
        }
        .padding(22)
        .background(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            alert.severity.color.opacity(0.92),
                            Color(red: 0.17, green: 0.08, blue: 0.10)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .onTapGesture {
            Task {
                await viewModel.openDetail(for: alert)
            }
        }
    }

    private func statusChip(title: String, systemImage: String, color: Color) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(color.opacity(0.18))
            .clipShape(Capsule())
    }
}

#Preview {
    DashboardView()
        .environmentObject(
            AlertFeedViewModel(
                service: MockAlertFeedService(),
                notificationManager: AlertNotificationManager(),
                summaryService: MockAlertSummaryService()
            )
        )
}
