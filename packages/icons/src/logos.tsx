"use client";

import Apple from "reicon-brands/icons/Apple";
import Github from "reicon-brands/icons/Github";
import Linux from "reicon-brands/icons/Linux";
import Qq from "reicon-brands/icons/Qq";
import Telegram from "reicon-brands/icons/Telegram";
import X from "reicon-brands/icons/X";

import { wrapBrand, type LyraIcon } from "./wrap";

export const AppleBrandLogo: LyraIcon = wrapBrand(Apple, "AppleBrandLogo");
export const GithubBrandLogo: LyraIcon = wrapBrand(Github, "GithubBrandLogo");
export const LinuxBrandLogo: LyraIcon = wrapBrand(Linux, "LinuxBrandLogo");
export const TelegramBrandLogo: LyraIcon = wrapBrand(Telegram, "TelegramBrandLogo");
export const XBrandLogo: LyraIcon = wrapBrand(X, "XBrandLogo");
export const QqBrandLogo: LyraIcon = wrapBrand(Qq, "QqBrandLogo");

// ponytail: reicon-brands@1.0.2 has no Windows glyph; drop this path when npm catches the site catalog.
const WINDOWS_MARK = {
  svgContent:
    '<path d="M3 4.2h8.1v7.5H3zm9.9 0H21v7.5h-8.1zM3 12.9h8.1V21H3zm9.9 0H21V21h-8.1z"/>'
};

export const WindowsBrandLogo: LyraIcon = wrapBrand(WINDOWS_MARK, "WindowsBrandLogo");
