import type { Metadata, Viewport } from "next";
import "@fontsource-variable/big-shoulders-display/wght";
import "@fontsource-variable/instrument-sans/wght";
import "@fontsource/stardos-stencil/400.css";
import "./globals.css";
import ProfileGate from "@/components/ProfileGate";

export const metadata: Metadata = {
  title: "Dhruva — know before it lands",
  description:
    "Dhruva is a multi-agent supply-chain intelligence desk for Indian importers and exporters. Type a shipment; agents check sea, air, rail and road against live chokepoint, cyclone, alert and weather data, then tell you how sure they are and what to do next.",
  applicationName: "Dhruva",
  openGraph: {
    title: "Dhruva — know before it lands",
    description: "Live multimodal shipment risk for Indian MSME importers and exporters.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ProfileGate />
      </body>
    </html>
  );
}
