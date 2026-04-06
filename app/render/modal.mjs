import { buildLocalLongBrief } from './modal-local-fallback.mjs';
import { mapAlertToLongBriefPayload } from './modal-payload-adapter.mjs';
import { requestRemoteLongBrief } from './modal-remote-client.mjs';
import { createModalUiController } from './modal-ui-controller.mjs';

const LONG_BRIEF_MAX_SOURCE_EXTRACT_CHARS = 8_000;
const LONG_BRIEF_FALLBACK_SOURCE_EXTRACT_CHARS = 3_500;

export function createModalRuntime(elements, options = {}) {
  const modalController = createModalUiController(elements, options);

  async function generateLongBrief() {
    const alert = modalController.getCurrentAlert();
    if (!alert || !elements.generateExpandedBrief || !elements.modalExpandedBrief || !elements.copyExpandedBrief) return;

    elements.generateExpandedBrief.disabled = true;
    elements.generateExpandedBrief.textContent = 'Generating...';

    try {
      const payloadAttempts = [
        mapAlertToLongBriefPayload(alert, LONG_BRIEF_MAX_SOURCE_EXTRACT_CHARS),
        mapAlertToLongBriefPayload(alert, LONG_BRIEF_FALLBACK_SOURCE_EXTRACT_CHARS)
      ];
      const brief = await requestRemoteLongBrief(payloadAttempts);
      modalController.setExpandedBrief(brief);
    } catch (error) {
      console.error('Remote long brief generation failed, falling back to local generator:', error);
      modalController.setExpandedBrief(buildLocalLongBrief(alert));
    } finally {
      elements.generateExpandedBrief.disabled = false;
    }
  }

  return { modalController, generateLongBrief };
}
