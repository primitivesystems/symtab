import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../ui/tooltip";

export function WebViewEditor({ url }: { url: string }) {
  const [isElectron, setIsElectron] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(url);
  const webviewRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    setIsElectron(navigator.userAgent.toLowerCase().includes("electron"));
  }, []);

  useEffect(() => {
    setCurrentUrl(url);
  }, [url]);

  // Electron webview navigation event listeners
  useEffect(() => {
    if (!isElectron) return;
    const wv = webviewRef.current;
    if (!wv) return;

    const onNavigate = () => {
      setCurrentUrl(wv.getURL?.() ?? url);
      setCanGoBack(wv.canGoBack?.() ?? false);
      setCanGoForward(wv.canGoForward?.() ?? false);
    };

    wv.addEventListener?.("did-navigate", onNavigate);
    wv.addEventListener?.("did-navigate-in-page", onNavigate);
    return () => {
      wv.removeEventListener?.("did-navigate", onNavigate);
      wv.removeEventListener?.("did-navigate-in-page", onNavigate);
    };
  }, [isElectron, url]);

  const goBack = useCallback(() => {
    if (isElectron) webviewRef.current?.goBack?.();
  }, [isElectron]);

  const goForward = useCallback(() => {
    if (isElectron) webviewRef.current?.goForward?.();
  }, [isElectron]);

  const reload = useCallback(() => {
    if (isElectron) {
      webviewRef.current?.reload?.();
    } else {
      // Reset iframe key to force reload
      setIframeKey((k) => k + 1);
    }
  }, [isElectron]);

  const openExternal = useCallback(() => {
    window.open(currentUrl, "_blank");
  }, [currentUrl]);

  return (
    <div className="relative flex h-full w-full flex-col bg-[var(--workbench-editor,#1e1e1e)]">
      {/* Browser toolbar */}
      <TooltipProvider delay={0}>
        <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[var(--workbench-border,#2b2b2b)] bg-[var(--workbench-editor,#1e1e1e)] px-1.5">
          {/* Navigation buttons */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={goBack}
                  disabled={isElectron ? !canGoBack : true}
                  className="grid size-[26px] place-items-center rounded text-[var(--workbench-muted,#888)] transition-colors hover:bg-[var(--workbench-hover,#2a2d2e)] hover:text-[var(--workbench-fg,#ccc)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--workbench-muted,#888)]"
                >
                  <ArrowLeft className="size-[16px]" />
                </button>
              }
            />
            <TooltipContent>Back</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={goForward}
                  disabled={isElectron ? !canGoForward : true}
                  className="grid size-[26px] place-items-center rounded text-[var(--workbench-muted,#888)] transition-colors hover:bg-[var(--workbench-hover,#2a2d2e)] hover:text-[var(--workbench-fg,#ccc)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--workbench-muted,#888)]"
                >
                  <ArrowRight className="size-[16px]" />
                </button>
              }
            />
            <TooltipContent>Forward</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={reload}
                  className="grid size-[26px] place-items-center rounded text-[var(--workbench-muted,#888)] transition-colors hover:bg-[var(--workbench-hover,#2a2d2e)] hover:text-[var(--workbench-fg,#ccc)]"
                >
                  <RotateCw className="size-[14px]" />
                </button>
              }
            />
            <TooltipContent>Reload</TooltipContent>
          </Tooltip>

          {/* URL bar */}
          <div className="mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-[4px] border border-[var(--workbench-border,#3c3c3c)] bg-[var(--workbench-input,#313131)] px-2 py-[3px]">
            <Globe className="size-[14px] shrink-0 text-[var(--workbench-muted,#888)]" />
            <input
              type="text"
              readOnly
              value={currentUrl}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--workbench-fg,#ccc)] outline-none placeholder:text-[var(--workbench-muted,#888)]"
              title={currentUrl}
            />
          </div>

          {/* Open in Default Browser */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={openExternal}
                  className="grid size-[26px] place-items-center rounded text-[var(--workbench-muted,#888)] transition-colors hover:bg-[var(--workbench-hover,#2a2d2e)] hover:text-[var(--workbench-fg,#ccc)]"
                >
                  <ExternalLink className="size-[14px]" />
                </button>
              }
            />
            <TooltipContent>Open in Default Browser</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {/* Webview / iframe content */}
      <div className="min-h-0 flex-1">
        {isElectron ? (
          <webview
            ref={webviewRef}
            src={url}
            className="h-full w-full border-none"
            allowpopups
          />
        ) : (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={url}
            className="h-full w-full border-none bg-white"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            title={currentUrl}
          />
        )}
      </div>
    </div>
  );
}
