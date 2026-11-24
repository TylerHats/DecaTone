import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

interface BrandingContextType {
  appName: string;
  logoUrl: string;
  faviconUrl: string;
  navbarIconUrl: string;
  refreshBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [appName, setAppName] = useState('DecaTone');
  const [logoUrl, setLogoUrl] = useState('/branding/logo.png');
  const [faviconUrl, setFaviconUrl] = useState('/branding/favicon.png');
  const [navbarIconUrl, setNavbarIconUrl] = useState('');

  const refreshBranding = useCallback(async () => {
    try {
      const res = await fetch('/api/branding/public');
      if (res.ok) {
        const data = await res.json();
        if (data.app_name) setAppName(data.app_name);
        if (data.logo_url) setLogoUrl(data.logo_url);
        else setLogoUrl('/branding/logo.png');

        if (data.favicon_url) {
          setFaviconUrl(data.favicon_url);
          let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
          if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.getElementsByTagName('head')[0].appendChild(link);
          }
          link.href = data.favicon_url;
        }
        if (data.navbar_icon_url) {
          setNavbarIconUrl(data.navbar_icon_url);
        } else {
          setNavbarIconUrl('');
        }
        document.title = `${data.app_name || 'DecaTone'} - Vintage Telephone Switchboard`;
      }
    } catch {
      // Ignore offline fetch failure
    }
  }, []);

  useEffect(() => {
    void refreshBranding();
  }, [refreshBranding]);

  const value = useMemo<BrandingContextType>(
    () => ({
      appName,
      logoUrl,
      faviconUrl,
      navbarIconUrl,
      refreshBranding
    }),
    [appName, logoUrl, faviconUrl, navbarIconUrl, refreshBranding]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
};

export const useBranding = () => {
  const context = useContext(BrandingContext);
  if (!context) throw new Error('useBranding must be used within a BrandingProvider');
  return context;
};
