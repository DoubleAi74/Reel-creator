/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    process.env.SUMUP_CHECKOUT_RETURN_URL,
    process.env.SUMUP_WEBHOOK_URL,
  ]
    .map((url) => {
      try {
        return new URL(url).host;
      } catch {
        return null;
      }
    })
    .filter(Boolean),
};

export default nextConfig;
