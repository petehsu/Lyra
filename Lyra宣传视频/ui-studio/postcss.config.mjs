import tailwindcss from "../../apps/desktop/node_modules/@tailwindcss/postcss/dist/index.mjs";

// The promo renderer imports the desktop stylesheet from outside this Vite
// root. Run the same Tailwind v4 transform as apps/desktop so primitive utility
// classes (switch geometry, focus rings, disabled states, and so on) are not
// silently dropped from the browser build.
export default {
  plugins: [tailwindcss()]
};
