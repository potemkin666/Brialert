import { buildLocalLongBrief } from './modal-local-fallback.mjs';
import { mapAlertToLongBriefPayload } from './modal-payload-adapter.mjs';
import { requestRemoteLongBrief } from './modal-remote-client.mjs';
import { createModalUiController } from './modal-ui-controller.mjs';

const LONG_BRIEF_MAX_SOURCE_EXTRACT_CHARS = 8_000;
const LONG_BRIEF_FALLBACK_SOURCE_EXTRACT_CHARS = 3_500;

export function createModalRuntime(elements, options = {}) {
  const modalController = options.modalController || createModalUiController(elements, options);
  const requestRemoteLongBriefFn = options.requestRemoteLongBrief || requestRemoteLongBrief;
  const buildLocalLongBriefFn = options.buildLocalLongBrief || buildLocalLongBrief;
  const mapAlertToLongBriefPayloadFn = options.mapAlertToLongBriefPayload || mapAlertToLongBriefPayload;

  function setLongBriefFallbackNotice(message = '') {
    if (!elements.longBriefFallbackNotice) return;
    const text = String(message || '').trim();
    elements.longBriefFallbackNotice.textContent = text;
    elements.longBriefFallbackNotice.hidden = !text;
  }

  async function generateLongBrief() {
    const alert = modalController.getCurrentAlert();
    if (!alert || !elements.generateExpandedBrief || !elements.modalExpandedBrief || !elements.copyExpandedBrief) return;

    elements.generateExpandedBrief.disabled = true;
    elements.generateExpandedBrief.textContent = 'Generating...';
    setLongBriefFallbackNotice('');

    try {
      const payloadAttempts = [
        mapAlertToLongBriefPayloadFn(alert, LONG_BRIEF_MAX_SOURCE_EXTRACT_CHARS),
        mapAlertToLongBriefPayloadFn(alert, LONG_BRIEF_FALLBACK_SOURCE_EXTRACT_CHARS)
      ];
      const brief = await requestRemoteLongBriefFn(payloadAttempts);
      modalController.setExpandedBrief(brief);
    } catch (error) {
      console.error('Remote long brief generation failed, falling back to local generator:', error);
      try {
        const fallbackBrief = buildLocalLongBriefFn(alert);
        modalController.setExpandedBrief(fallbackBrief);
        setLongBriefFallbackNotice('Vercel agent unavailable. Long brief generated locally on your device.');
      } catch (fallbackError) {
        console.error('Local long brief fallback failed:', fallbackError);
        setLongBriefFallbackNotice('Long brief generation failed. Please retry.');
      }
    } finally {
      elements.generateExpandedBrief.disabled = false;
    }
  }

  return { modalController, generateLongBrief };
}
