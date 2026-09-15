export const LYRA_BOOTSTRAP_SCREEN_ID = "lyra-bootstrap-screen";

export const setLyraBootstrapScreenVisible = (visible: boolean): void => {
  const screen = document.getElementById(LYRA_BOOTSTRAP_SCREEN_ID);
  if (screen === null) {
    return;
  }
  screen.hidden = !visible;
  screen.setAttribute("aria-busy", visible ? "true" : "false");
};

export const dismissLyraBootstrapScreen = (): void => {
  setLyraBootstrapScreenVisible(false);
};

export const revealLyraBootstrapScreen = (): void => {
  setLyraBootstrapScreenVisible(true);
};
