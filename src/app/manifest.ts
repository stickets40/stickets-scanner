import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stickets Scanner",
    short_name: "Scanner",
    description: "QR code ticket scanner for Stickets events",
    start_url: "/scan",
    display: "standalone",
    orientation: "portrait",
    // Both match --color-surface-0. background_color paints the launch splash;
    // it was white, so installing the app and opening it flashed a white
    // screen before the black camera view — at a night gate, in the operator's
    // face, every single launch.
    background_color: "#100c0b",
    theme_color: "#100c0b",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
