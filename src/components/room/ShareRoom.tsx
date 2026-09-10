"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Share2 } from "lucide-react";
import type { Messages } from "@/i18n";

interface ShareRoomProps {
  readonly code: string;
  readonly messages: Messages["room"];
}

export function ShareRoom({ code, messages }: ShareRoomProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    const roomUrl = `${window.location.origin}/room/${code}`;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la URL solo se conoce en el navegador
    setUrl(roomUrl);
    QRCode.toDataURL(roomUrl, { width: 320, margin: 1 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [code]);

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: messages.shareTitle, url });
        return;
      }
      await navigator.clipboard.writeText(url);
    } catch {
      // El usuario canceló o el navegador lo bloqueó: no hay nada que hacer.
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="rounded-xl border-2 border-primary bg-surface px-6 py-3 text-center indent-[0.35em] font-mono text-3xl font-bold tracking-[0.35em] text-primary">
        {code}
      </p>

      {qr && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={qr}
          alt={messages.qrAlt}
          className="h-64 w-64 rounded-xl border border-primary/30 bg-paper p-2"
        />
      )}

      <button
        type="button"
        onClick={() => void share()}
        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
      >
        <Share2 aria-hidden="true" size={16} />
        {messages.share}
      </button>
    </div>
  );
}
