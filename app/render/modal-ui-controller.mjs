import {
  buildAuditBlock,
  buildBriefing,
  effectiveSummary,
  renderCorroboratingSources,
  renderSceneClock,
  severityLabel
} from '../../shared/alert-view-model.mjs';
import { createModalController } from '../../shared/modal-briefing.mjs';

export function createModalUiController(elements, options = {}) {
  const baseController = createModalController({
    modal: elements.modal,
    modalTitle: elements.modalTitle,
    modalMeta: elements.modalMeta,
    modalAiSummary: elements.modalAiSummary,
    modalSummary: elements.modalSummary,
    modalSceneClock: elements.modalSceneClock,
    sceneClockPanel: elements.sceneClockPanel,
    modalAudit: elements.modalAudit,
    modalCorroboration: elements.modalCorroboration,
    auditPanel: elements.auditPanel,
    corroborationPanel: elements.corroborationPanel,
    modalSeverity: elements.modalSeverity,
    modalStatus: elements.modalStatus,
    modalSource: elements.modalSource,
    modalRegion: elements.modalRegion,
    modalBriefing: elements.modalBriefing,
    modalLink: elements.modalLink,
    copyBriefing: elements.copyBriefing,
    expandedBriefPanel: elements.expandedBriefPanel,
    modalExpandedBrief: elements.modalExpandedBrief,
    generateExpandedBrief: elements.generateExpandedBrief,
    copyExpandedBrief: elements.copyExpandedBrief
  }, {
    effectiveSummary,
    buildBriefing,
    renderSceneClock,
    buildAuditBlock,
    renderCorroboratingSources,
    severityLabel
  });

  return {
    openDetail(alert) {
      baseController.openDetail(alert);
      options?.onAlertChange?.(baseController.getCurrentAlert());
    },
    closeDetailPanel() {
      baseController.closeDetailPanel();
      options?.onAlertChange?.(null);
    },
    copyTextToButton: baseController.copyTextToButton,
    getCurrentAlert: baseController.getCurrentAlert,
    setExpandedBrief: baseController.setExpandedBrief
  };
}
