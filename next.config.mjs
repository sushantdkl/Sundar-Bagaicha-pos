/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [],
  },
  async rewrites() {
    return [
      // Static Sundar Bagaicha Events landing (public/sundar-bagaicha.html).
      { source: '/', destination: '/sundar-bagaicha.html' },
      // Uploaded images (UPLOADS_DIR) via media route — /uploads/menu/*.jpg in prod.
      {
        source: '/uploads/:path*',
        destination: '/api/media/:path*',
      },
    ];
  },
};

export default nextConfig;
