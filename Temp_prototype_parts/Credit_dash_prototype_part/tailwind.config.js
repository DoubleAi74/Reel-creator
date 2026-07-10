/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#171717",
        paper: "#f7f4ee",
        ember: "#ef4444",
        mint: "#2dd4bf",
      },
      boxShadow: {
        panel: "0 18px 50px rgba(23, 23, 23, 0.10)",
      },
    },
  },
  plugins: [],
};
