'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

const STORAGE_TOKEN = 'crm_install_token';
const STORAGE_PROJECT = 'crm_install_project';

type GateState = 'loading' | 'not-found' | 'allowed';

/**
 * Componente React `InstallEntryPage`.
 *
 * Default-deny: se o servidor disser `allowed: false` (ou erro de rede), renderiza um
 * 404 silencioso — sem redirects que vazam a existência da rota de instalação.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function InstallEntryPage() {
  const router = useRouter();
  const [gate, setGate] = useState<GateState>('loading');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // O token (se configurado) deve vir na query da URL do operador.
        const url = new URL(window.location.href);
        const token = url.searchParams.get('token') || '';

        const res = await fetch(
          `/api/installer/check-initialized${token ? `?token=${encodeURIComponent(token)}` : ''}`,
          {
            cache: 'no-store',
            headers: token ? { 'x-installer-token': token } : undefined,
          }
        );
        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        // Default-deny: qualquer resposta diferente de `allowed: true` vira 404.
        if (data?.allowed !== true || data?.initialized === true) {
          setGate('not-found');
          return;
        }

        const storedToken = localStorage.getItem(STORAGE_TOKEN);
        const storedProject = localStorage.getItem(STORAGE_PROJECT);
        if (storedToken && storedProject) {
          router.replace('/install/wizard');
        } else {
          router.replace('/install/start');
        }
      } catch (err) {
        if (!cancelled) {
          // Fail-closed: erro de rede/servidor => 404 silencioso.
          console.warn('[install] Error checking initialization:', err);
          setGate('not-found');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [router]);

  if (gate === 'not-found') {
    // Renderiza um 404 silencioso sem pistas sobre a existência do wizard.
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-dark-bg flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-slate-400 dark:text-slate-600">404</h1>
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            This page could not be found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-dark-bg flex items-center justify-center relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        {/* Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06)_0%,rgba(2,6,23,0)_42%,rgba(2,6,23,0.88)_100%)] dark:opacity-100 opacity-0" />
        {/* Film grain (SVG noise, very subtle) */}
        <div
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E\")",
          }}
        />
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-cyan-500/18 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] bg-teal-500/16 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex flex-col items-center gap-3"
      >
        <Loader2 className="w-6 h-6 text-cyan-300 animate-spin" />
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Preparando a rota…
        </div>
      </motion.div>
    </div>
  );
}
