import React, { createContext, useContext, useState, useEffect } from 'react';

interface BrandingContextType {
  appName: string;
  logoUrl: string;
  refreshBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [appName, setAppName] = useState('DecaTone');
  const [logoUrl, setLogoUrl] = useState('/branding/logo.png');

  const refreshBranding = async () => {
    try {
      const res = await fetch('/api/branding/public');
      if (res.ok) {
        const data = await res.json();
        if (data.app_name) setAppName(data.app_name);
        if (data.logo_url) setLogoUrl(data.logo_url);
        document.title = `${data.app_name || 'DecaTone'} - Vintage Telephone Switchboard`;
      }
    } catch (e) {}
  };

  useEffect(() => {
    refreshBranding();
  }, []);

  return (
    <BrandingContext.Provider value={{ appName, logoUrl, refreshBranding }}>
      {children}
    </BrandingContext.Provider>
  );
};

export const useBranding = () => {
  const context = useContext(BrandingContext);
  if (!context) throw new Error('useBranding must be used within a BrandingProvider');
  return context;
};
