import {
  initializeTheme,
  subscribeToTheme,
  toggleResolvedTheme
} from "./lib/theme.js";

const steps = [...document.querySelectorAll("[data-step]")];
const progressSteps = [...document.querySelectorAll("[data-progress-step]")];
const elements = {
  stepCounter: document.querySelector("#stepCounter"),
  themeToggle: document.querySelector("#themeToggle"),
  privacyAcceptance: document.querySelector("#privacyAcceptance"),
  telemetryOff: document.querySelector("#telemetryOff"),
  telemetryOn: document.querySelector("#telemetryOn"),
  telemetrySummary: document.querySelector("#telemetrySummary"),
  formError: document.querySelector("#formError"),
  backButton: document.querySelector("#backButton"),
  nextButton: document.querySelector("#nextButton"),
  actionBar: document.querySelector("#actionBar"),
  successStep: document.querySelector("#successStep"),
  openSettingsButton: document.querySelector("#openSettingsButton"),
  closeSetupButton: document.querySelector("#closeSetupButton")
};

let currentStep = 0;
let completionBusy = false;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Veilance did not return a response");
  return response;
}

function showStep(index) {
  currentStep = Math.max(0, Math.min(steps.length - 1, Number(index) || 0));
  for (const step of steps) {
    const active = Number(step.dataset.step) === currentStep;
    step.hidden = !active;
    step.classList.toggle("active", active);
  }
  for (const item of progressSteps) {
    const itemStep = Number(item.dataset.progressStep);
    item.classList.toggle("active", itemStep === currentStep);
    item.classList.toggle("complete", itemStep < currentStep);
    if (itemStep === currentStep) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  }
  elements.stepCounter.textContent = `Step ${currentStep + 1} of ${steps.length}`;
  elements.backButton.hidden = currentStep === 0;
  elements.nextButton.textContent = currentStep === steps.length - 1 ? "Finish setup" : "Continue";
  elements.formError.textContent = "";
  document.querySelector(".setup-shell")?.scrollIntoView({ block: "start" });
  steps[currentStep]?.querySelector("h1")?.focus?.({ preventScroll: true });
}

function validateStep() {
  if (currentStep === 2 && !elements.privacyAcceptance.checked) {
    elements.formError.textContent = "Accept the Privacy Policy to continue.";
    elements.privacyAcceptance.focus();
    return false;
  }
  return true;
}

async function completeSetup() {
  if (completionBusy || !validateStep()) return;
  completionBusy = true;
  elements.nextButton.disabled = true;
  elements.nextButton.textContent = "Saving…";
  elements.formError.textContent = "";
  try {
    const telemetryEnabled = elements.telemetryOn.checked;
    const response = await send({
      type: "VEILANCE_COMPLETE_ONBOARDING",
      accountMode: "guest",
      privacyAccepted: elements.privacyAcceptance.checked,
      telemetryEnabled
    });
    for (const step of steps) step.hidden = true;
    for (const item of progressSteps) {
      item.classList.remove("active");
      item.classList.add("complete");
    }
    elements.stepCounter.textContent = "Setup complete";
    elements.actionBar.hidden = true;
    elements.successStep.hidden = false;
    elements.telemetrySummary.textContent = response.onboarding?.telemetryEnabled ? "On" : "Off";
    elements.successStep.querySelector("h1")?.focus?.({ preventScroll: true });
  } catch (error) {
    elements.formError.textContent = error?.message || "Setup could not be saved. Try again.";
  } finally {
    completionBusy = false;
    elements.nextButton.disabled = false;
    if (!elements.actionBar.hidden) elements.nextButton.textContent = "Finish setup";
  }
}

async function loadExistingState() {
  try {
    const response = await send({ type: "VEILANCE_GET_ONBOARDING_STATE" });
    const onboarding = response.onboarding || {};
    elements.privacyAcceptance.checked = onboarding.privacyPolicyAccepted === true;
    const telemetryEnabled = Boolean(
      response.snapshotUpload?.consent &&
      response.snapshotUpload?.automatic &&
      response.snapshotCapture?.automatic
    );
    elements.telemetryOn.checked = telemetryEnabled;
    elements.telemetryOff.checked = !telemetryEnabled;
  } catch (error) {
    elements.formError.textContent = error?.message || "Existing settings could not be loaded. You can still continue setup.";
  }
}

elements.nextButton.addEventListener("click", () => {
  if (!validateStep()) return;
  if (currentStep < steps.length - 1) showStep(currentStep + 1);
  else void completeSetup();
});

elements.backButton.addEventListener("click", () => showStep(currentStep - 1));
elements.privacyAcceptance.addEventListener("change", () => {
  if (elements.privacyAcceptance.checked) elements.formError.textContent = "";
});

elements.themeToggle.addEventListener("click", () => void toggleResolvedTheme().catch(() => {}));
subscribeToTheme(({ resolved }) => {
  const nextTheme = resolved === "dark" ? "light" : "dark";
  elements.themeToggle.title = `Use ${nextTheme} mode`;
  elements.themeToggle.setAttribute("aria-label", `Use ${nextTheme} mode`);
});

elements.openSettingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
elements.closeSetupButton.addEventListener("click", () => window.close());

void initializeTheme();
showStep(0);
void loadExistingState();
