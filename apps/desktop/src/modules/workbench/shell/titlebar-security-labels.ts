import type { I18nKey } from "../i18n/types";
import type { TitlebarNavigationSecurityLabels } from "./titlebar-navigation";

type WorkbenchTranslator = (key: I18nKey) => string;

export const createTitlebarSecurityLabels = (
  t: WorkbenchTranslator
): TitlebarNavigationSecurityLabels => ({
  ariaLabel: t("navigation.securityAriaLabel"),
  title: t("navigation.securityTitle"),
  secureTitle: t("navigation.securitySecureTitle"),
  secureBody: t("navigation.securitySecureBody"),
  insecureTitle: t("navigation.securityInsecureTitle"),
  insecureBody: t("navigation.securityInsecureBody"),
  systemTitle: t("navigation.securitySystemTitle"),
  systemBody: t("navigation.securitySystemBody"),
  connectionLabel: t("navigation.securityConnectionLabel"),
  addressLabel: t("navigation.securityAddressLabel"),
  hostLabel: t("navigation.securityHostLabel"),
  originLabel: t("navigation.securityOriginLabel"),
  schemeLabel: t("navigation.securitySchemeLabel"),
  certificateUnavailableLabel: t("navigation.securityCertificateUnavailableLabel"),
  certificateNotApplicableLabel: t("navigation.securityCertificateNotApplicableLabel"),
  secureConnection: t("navigation.securitySecureConnection"),
  insecureConnection: t("navigation.securityInsecureConnection"),
  localConnection: t("navigation.securityLocalConnection"),
  unavailableNotHttps: t("navigation.securityUnavailableNotHttps"),
  unavailableNoCertificate: t("navigation.securityUnavailableNoCertificate")
});
