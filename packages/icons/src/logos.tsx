"use client";

import Apple from "reicon-brands/icons/Apple";
import Github from "reicon-brands/icons/Github";
import Google from "reicon-brands/icons/Google";
import Linux from "reicon-brands/icons/Linux";
import Qq from "reicon-brands/icons/Qq";
import Telegram from "reicon-brands/icons/Telegram";
import X from "reicon-brands/icons/X";

import { wrapBrand, type LyraIcon } from "./wrap";

export const AppleBrandLogo: LyraIcon = wrapBrand(Apple, "AppleBrandLogo");
export const GithubBrandLogo: LyraIcon = wrapBrand(Github, "GithubBrandLogo");
export const GoogleBrandLogo: LyraIcon = wrapBrand(Google, "GoogleBrandLogo");
export const LinuxBrandLogo: LyraIcon = wrapBrand(Linux, "LinuxBrandLogo");
export const TelegramBrandLogo: LyraIcon = wrapBrand(Telegram, "TelegramBrandLogo");
export const XBrandLogo: LyraIcon = wrapBrand(X, "XBrandLogo");
export const QqBrandLogo: LyraIcon = wrapBrand(Qq, "QqBrandLogo");

// ponytail: reicon-brands@1.0.2 has no Bing glyph; drop this path when npm catches the site catalog.
const BING_MARK = {
  svgContent:
    '<path d="M4.842.005a.966.966 0 01.604.142l2.62 1.813c.369.256.492.352.637.496.471.47.752 1.09.797 1.765l.008.847.003 1.441.004 13.002.144-.094 7.015-4.353.015.003.029.01c-.398-.17-.893-.339-1.655-.566l-.484-.146c-.584-.18-.71-.238-.921-.38a2.009 2.009 0 01-.37-.312 2.172 2.172 0 01-.41-.592L11.32 9.063c-.166-.444-.166-.49-.156-.63a.92.92 0 01.806-.864l.094-.01c.044-.005.22.023.29.044l.052.021c.06.026.16.075.313.154l3.63 1.908a6.626 6.626 0 013.292 4.531c.194.99.159 2.037-.102 3.012-.216.805-.639 1.694-1.054 2.213l-.08.099-.047.05c-.01.01-.013.01-.01.002l.043-.074-.072.114c-.011.031-.233.28-.38.425l-.17.161c-.22.202-.431.36-.832.62L13.544 23c-.941.6-1.86.912-2.913.992-.23.018-.854.008-1.074-.017a6.31 6.31 0 01-1.658-.412c-1.854-.738-3.223-2.288-3.705-4.195a8.077 8.077 0 01-.121-.57l-.046-.325a1.123 1.123 0 01-.014-.168l-.006-.029L4 11.617 4.01.866a.981.981 0 01.007-.111.943.943 0 01.825-.75z"/>'
};

export const BingBrandLogo: LyraIcon = wrapBrand(BING_MARK, "BingBrandLogo");

// ponytail: reicon-brands@1.0.2 has no Windows glyph; drop this path when npm catches the site catalog.
const WINDOWS_MARK = {
  svgContent:
    '<path d="M3 4.2h8.1v7.5H3zm9.9 0H21v7.5h-8.1zM3 12.9h8.1V21H3zm9.9 0H21V21h-8.1z"/>'
};

export const WindowsBrandLogo: LyraIcon = wrapBrand(WINDOWS_MARK, "WindowsBrandLogo");
