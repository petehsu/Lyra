(function () {
  "use strict";

  var root = document.documentElement;
  var supportedLocales = ["zh-CN", "en-US"];
  var savedLocale = window.localStorage.getItem("lyra-legal-locale");
  var queryLocale = new URLSearchParams(window.location.search).get("lang");
  var browserLocale = navigator.language && navigator.language.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en-US";
  var locale = supportedLocales.includes(queryLocale)
    ? queryLocale
    : supportedLocales.includes(savedLocale)
      ? savedLocale
      : browserLocale;
  var savedTheme = window.localStorage.getItem("lyra-legal-theme");
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = savedTheme === "light" || savedTheme === "dark"
    ? savedTheme
    : systemDark
      ? "dark"
      : "light";

  function setLanguage(nextLocale) {
    locale = nextLocale;
    window.localStorage.setItem("lyra-legal-locale", locale);
    root.lang = locale;
    document.querySelectorAll("[data-lang]").forEach(function (element) {
      element.classList.toggle("is-active", element.dataset.lang === locale);
    });
    document.querySelectorAll("[data-locale-label]").forEach(function (element) {
      element.textContent = locale === "zh-CN" ? "English" : "中文";
    });
    document.querySelectorAll("[data-localized-href]").forEach(function (element) {
      var href = element.getAttribute("data-localized-href");
      if (href) {
        element.setAttribute("href", href + "?lang=" + encodeURIComponent(locale));
      }
    });
  }

  function setTheme(nextTheme) {
    theme = nextTheme;
    root.dataset.theme = theme;
    window.localStorage.setItem("lyra-legal-theme", theme);
    document.querySelectorAll("[data-theme-label]").forEach(function (element) {
      element.textContent = theme === "dark"
        ? (locale === "zh-CN" ? "浅色" : "Light")
        : (locale === "zh-CN" ? "深色" : "Dark");
    });
  }

  document.querySelectorAll("[data-language-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      setLanguage(locale === "zh-CN" ? "en-US" : "zh-CN");
    });
  });

  document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      setTheme(theme === "dark" ? "light" : "dark");
    });
  });

  setTheme(theme);
  setLanguage(locale);
}());
