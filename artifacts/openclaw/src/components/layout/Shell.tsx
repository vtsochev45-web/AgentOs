import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  TerminalSquare,
  Network,
  Activity,
  Settings,
  LayoutDashboard,
  Bot,
  Brain,
  Target,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [location] = useLocation();

  const navItems = [
    { path: "/", icon: LayoutDashboard, label: "Home" },
    { path: "/agents", icon: Bot, label: "Agents" },
    { path: "/vps", icon: TerminalSquare, label: "VPS" },
    { path: "/network", icon: Network, label: "Network" },
    { path: "/goals", icon: Target, label: "Goals" },
    { path: "/activity", icon: Activity, label: "Activity" },
    { path: "/intelligence", icon: Brain, label: "Intel" },
    { path: "/settings", icon: Settings, label: "Config" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row relative z-0">
      {/* Background Image / Glow */}
      <div className="fixed inset-0 z-[-1] pointer-events-none opacity-40 mix-blend-screen">
        <img 
          src={`${import.meta.env.BASE_URL}images/bg-glow.png`} 
          alt="glow" 
          className="w-full h-full object-cover" 
        />
      </div>

      {/* Desktop Sidebar */}
      <nav className="hidden md:flex flex-col w-64 border-r border-white/10 glass-panel fixed inset-y-0 left-0 z-10 p-4">
        <Link href="/" className="flex items-center gap-3 px-2 mb-8 mt-2 group select-none">
          <img
            src={`${import.meta.env.BASE_URL}logo.svg`}
            alt="Openclaw"
            className="w-9 h-9 group-hover:scale-105 transition-transform duration-200"
          />
          <h1
            className="text-xl font-bold tracking-tight text-white"
            style={{ fontFamily: "'Clash Display', system-ui, sans-serif" }}
          >
            Openclaw
          </h1>
        </Link>
        
        <div className="flex-1 flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            const Icon = item.icon;
            
            return (
              <Link key={item.path} href={item.path} className={`
                flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden
                ${isActive
                  ? 'text-white bg-primary/15 border border-primary/25 shadow-[inset_0_0_16px_rgba(255,77,77,0.08)]'
                  : 'text-muted-foreground hover:text-white hover:bg-white/5'}
              `}>
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary' : 'group-hover:text-white'}`} />
                <span className="font-medium text-sm">{item.label}</span>
                {isActive && (
                  <motion.div 
                    layoutId="activeTab" 
                    className="absolute left-0 w-0.5 h-full bg-primary rounded-r"
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
              </Link>
            );
          })}
        </div>
        
        <div className="mt-auto px-4 py-4 border-t border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-fast shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
            <span className="text-xs text-muted-foreground font-mono tracking-widest">SYSTEM ONLINE</span>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:pl-64 min-w-0 pb-20 md:pb-0 h-screen overflow-hidden relative">
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8 scroll-smooth custom-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={location}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.18 }}
              className="h-full flex flex-col"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 glass-panel border-t border-white/10 z-50 px-1 py-2 flex justify-around items-center safe-area-bottom">
        <Link href="/" className="flex flex-col items-center justify-center w-12 h-12">
          <img
            src={`${import.meta.env.BASE_URL}logo.svg`}
            alt="Openclaw"
            className="w-7 h-7"
          />
        </Link>
        {navItems.map((item) => {
          const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
          const Icon = item.icon;
          
          return (
            <Link key={item.path} href={item.path} className={`
              flex flex-col items-center justify-center w-12 h-12 rounded-xl relative
              ${isActive ? 'text-primary' : 'text-muted-foreground'}
            `}>
              <Icon className="w-5 h-5 mb-0.5" />
              <span className="text-[9px] font-medium">{item.label}</span>
              {isActive && (
                <motion.div 
                  layoutId="activeBottomTab" 
                  className="absolute -top-2 w-6 h-0.5 rounded-full bg-primary shadow-[0_0_6px_rgba(255,77,77,0.8)]"
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
