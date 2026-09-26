import { ArrowLeft, ArrowRight, RotateCw, Globe, X } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import type { WorkspaceTab } from "./tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@symtab/shared-ui/components/tooltip";

export function BrowserView({ tab, onClose }: { tab: WorkspaceTab; onClose: () => void }) {
  const webviewRef = useRef<any>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [url, setUrl] = useState(tab.browserUrl ?? "");

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const updateNav = () => {
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };

    const handleDidNavigate = (e: any) => {
      setUrl(e.url);
      updateNav();
    };

    webview.addEventListener("did-navigate", handleDidNavigate);
    webview.addEventListener("did-navigate-in-page", handleDidNavigate);

    return () => {
      webview.removeEventListener("did-navigate", handleDidNavigate);
      webview.removeEventListener("did-navigate-in-page", handleDidNavigate);
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-2 p-2 border-b text-muted-foreground bg-muted/30">
        <Tooltip>
          <TooltipTrigger
            render={<button
              className="p-1 rounded hover:bg-accent disabled:opacity-50"
              disabled={!canGoBack}
              onClick={() => webviewRef.current?.goBack()}
            />}
          >
            <ArrowLeft className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Back</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={<button
              className="p-1 rounded hover:bg-accent disabled:opacity-50"
              disabled={!canGoForward}
              onClick={() => webviewRef.current?.goForward()}
            />}
          >
            <ArrowRight className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Forward</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={<button
              className="p-1 rounded hover:bg-accent"
              onClick={() => webviewRef.current?.reload()}
            />}
          >
            <RotateCw className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>

        <input
          type="text"
          readOnly
          value={url}
          className="flex-1 bg-background border rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
        />

        <Tooltip>
          <TooltipTrigger
            render={<button
              className="p-1 rounded hover:bg-accent"
              onClick={() => window.open(url, "_blank")}
            />}
          >
            <Globe className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Open in Default Browser</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={<button
              className="p-1 rounded hover:bg-accent"
              onClick={onClose}
            />}
          >
            <X className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>
      <webview
        ref={webviewRef}
        src={tab.browserUrl}
        className="flex-1 bg-white"
      />
    </div>
  );
}
