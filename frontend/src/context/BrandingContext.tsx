import React, { createContext, useContext, useState, useEffect } from 'react';

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
  const [navbarIconUrl, setNavbarIconUrl] = useState('/branding/navbar_icon.png');

  const refreshBranding = async () => {
    try {
      const res = await fetch('/api/branding/public');
      if (res.ok) {
        const data = await res.json();
        if (data.app_name) setAppName(data.app_name);
        if (data.logo_url) setLogoUrl(data.logo_url);
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
        if (data.navbar_icon_url) setNavbarIconUrl(data.navbar_icon_url);
        document.title = `${data.app_name || 'DecaTone'} - Vintage Telephone Switchboard`;
      }
    } catch (e) {}
  };

  useEffect(() => {
    refreshBranding();
  }, []);

  return (
    <BrandingContext.Provider value={{ appName, logoUrl, faviconUrl, navbarIconUrl, refreshBranding }}>
      {children}
    </BrandingContext.Provider>
  );
};

export const useBranding = () => {
  const context = useContext(BrandingContext);
  if (!context) throw new Error('useBranding must be used within a BrandingProvider');
  return context;
};
