export const LYRA_BOOTSTRAP_SCREEN_ID = "lyra-bootstrap-screen";
const LYRA_BOOTSTRAP_LOGO_ID = "lyra-bootstrap-logo";
const LYRA_STARTUP_READY_CLASS = "lyra-startup-ready";
const BOOTSTRAP_FADE_MS = 500;

let hideTimer: number | null = null;
let animationDone = false;
let revealRequested = false;
let watchingAnimation = false;

const bootstrapScreen = (): HTMLElement | null =>
  document.getElementById(LYRA_BOOTSTRAP_SCREEN_ID);

const bootstrapLogo = (): HTMLElement | null =>
  document.getElementById(LYRA_BOOTSTRAP_LOGO_ID);

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const finishIfReady = (): void => {
  if (!animationDone || !revealRequested) {
    return;
  }
  document.body.classList.add(LYRA_STARTUP_READY_CLASS);
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
  }
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    const screen = bootstrapScreen();
    if (screen === null) {
      return;
    }
    screen.hidden = true;
    screen.setAttribute("aria-busy", "false");
  }, BOOTSTRAP_FADE_MS);
};

const markAnimationDone = (): void => {
  animationDone = true;
  finishIfReady();
};

const watchLogoAnimation = (): void => {
  if (watchingAnimation) {
    return;
  }
  watchingAnimation = true;
  if (prefersReducedMotion()) {
    markAnimationDone();
    return;
  }
  const logo = bootstrapLogo();
  const running = typeof logo?.getAnimations === "function"
    && logo.getAnimations().some((animation) => animation.playState === "running");
  if (logo === null || !running) {
    markAnimationDone();
    return;
  }
  logo.addEventListener("animationend", markAnimationDone, { once: true });
  window.setTimeout(markAnimationDone, 1000);
};

const replayLogoAnimation = (): void => {
  const logo = bootstrapLogo();
  animationDone = false;
  watchingAnimation = false;
  if (logo === null || prefersReducedMotion()) {
    watchLogoAnimation();
    return;
  }
  logo.style.animation = "none";
  void logo.offsetWidth;
  logo.style.animation = "";
  watchLogoAnimation();
};

export const dismissLyraBootstrapScreen = (): void => {
  watchLogoAnimation();
  revealRequested = true;
  finishIfReady();
};

export const revealLyraBootstrapScreen = (): void => {
  const screen = bootstrapScreen();
  const alreadyShowing = screen !== null
    && !screen.hidden
    && !document.body.classList.contains(LYRA_STARTUP_READY_CLASS);
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  revealRequested = false;
  document.body.classList.remove(LYRA_STARTUP_READY_CLASS);
  if (screen === null || alreadyShowing) {
    return;
  }
  screen.hidden = false;
  screen.setAttribute("aria-busy", "true");
  replayLogoAnimation();
};
