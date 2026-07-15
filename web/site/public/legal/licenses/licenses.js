(function () {
  "use strict";

  var list = document.querySelector("[data-license-list]");
  var status = document.querySelector("[data-license-status]");
  var updated = document.querySelector("[data-license-updated]");
  var counts = document.querySelectorAll("[data-license-count]");

  if (!list) return;

  function addText(parent, tag, className, text) {
    var element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
  }

  function resolveSource(item) {
    var source = item.repository || item.homepage || item.source;
    if (typeof source !== "string") return null;
    source = source
      .replace(/^git\+/u, "")
      .replace(/^git@github\.com:(.+?)(?:\.git)?$/u, "https://github.com/$1");
    return /^https?:\/\//u.test(source) ? source : null;
  }

  function addUnavailableNotice(parent) {
    var message = document.createElement("p");
    message.className = "license-entry-unavailable";
    [
      ["zh-CN", "当前安装包未附带许可证全文，请以以上许可证标识及上游源码中的声明为准。"],
      ["en-US", "The installed package does not include the full license text. Refer to the identifier above and the notices in the upstream source."]
    ].forEach(function (copy) {
      var span = document.createElement("span");
      span.dataset.lang = copy[0];
      span.textContent = copy[1];
      span.classList.toggle("is-active", document.documentElement.lang === copy[0]);
      message.appendChild(span);
    });
    parent.appendChild(message);
  }

  fetch("/legal/licenses/notices.json")
    .then(function (response) {
      if (!response.ok) throw new Error("Unable to load license notices");
      return response.json();
    })
    .then(function (documentData) {
      if (updated && documentData.generatedAt) {
        var date = new Date(documentData.generatedAt);
        updated.textContent = "Last updated " + new Intl.DateTimeFormat("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric"
        }).format(date);
      }

      if (status) status.remove();
      counts.forEach(function (count) {
        count.textContent = documentData.packageCount + (
          count.closest("[data-lang]")?.dataset.lang === "zh-CN"
            ? " 个开源软件组件"
            : " open source components"
        );
      });

      var fragment = document.createDocumentFragment();
      documentData.items.forEach(function (item) {
        var section = document.createElement("section");
        section.className = "license-entry";
        addText(section, "h2", "", item.name + (item.version ? " (" + item.version + ")" : ""));
        addText(section, "p", "license-entry-name", item.license);
        var source = resolveSource(item);
        if (source) {
          var sourceLine = document.createElement("p");
          sourceLine.className = "license-entry-source";
          var sourceLink = document.createElement("a");
          sourceLink.href = source;
          sourceLink.target = "_blank";
          sourceLink.rel = "noreferrer";
          sourceLink.textContent = source;
          sourceLine.appendChild(sourceLink);
          section.appendChild(sourceLine);
        }

        var body = [item.noticeText, item.licenseText]
          .filter(function (value) {
            return typeof value === "string" && value.trim().length > 0;
          })
          .map(function (value) {
            return value.trim();
          })
          .join("\n\n");

        if (body) {
          addText(section, "div", "license-entry-text", body);
        } else {
          addUnavailableNotice(section);
        }
        fragment.appendChild(section);
      });
      list.appendChild(fragment);
    })
    .catch(function () {
      if (status) {
        status.textContent = document.documentElement.lang === "zh-CN"
          ? "许可声明暂时无法加载。"
          : "License notices are temporarily unavailable.";
      }
    });
}());
