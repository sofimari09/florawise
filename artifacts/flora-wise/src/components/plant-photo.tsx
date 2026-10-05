import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { getPrivatePhoto } from "@workspace/api-client-react";

export function PlantPhoto({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const { userId, getToken } = useAuth();
  const privateId = src.match(/^\/api\/storage\/objects\/photos\/([0-9a-f-]{36})$/)?.[1];
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const key = `${userId}:${src}`;
  useEffect(() => {
    setFailed(false);
    if (!privateId) return;
    const controller = new AbortController();
    let url: string | undefined;
    (async () => {
      const token = await getToken();
      if (!token) throw new Error("Потрібен вхід");
      const blob = await getPrivatePhoto(privateId, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
      });
      if (!controller.signal.aborted) {
        url = URL.createObjectURL(blob);
        setLoaded({ key, url });
      }
    })().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [privateId, getToken, key]);
  const url = privateId ? loaded?.key === key ? loaded.url : undefined : src;
  if (!url || failed) return <span role="status" className="p-3 text-xs text-muted-foreground">{failed ? "Не вдалося отримати фото. Оновіть сторінку." : "Завантажуємо фото…"}</span>;
  return <img src={url} alt={alt} className={className} onError={() => setFailed(true)} />;
}
