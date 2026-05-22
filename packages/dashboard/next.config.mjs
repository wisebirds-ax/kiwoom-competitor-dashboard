/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'displayads-formats.googleusercontent.com' },
      { protocol: 'https', hostname: 'scontent.xx.fbcdn.net' },
      { protocol: 'https', hostname: 'scontent-icn2-1.xx.fbcdn.net' },
      { protocol: 'https', hostname: 'video-icn2-1.xx.fbcdn.net' },
    ],
  },
};

export default nextConfig;
