import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  TerminalSquare, 
  Network, 
  Activity, 
  Settings, 
  LayoutDashboard, 
  Bot,
  Orbit
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
    { path: "/activity", icon: Activity, label: "Activity" },
    { path: "/settings", icon: Settings, label: "Settings" },
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
        <div className="flex items-center gap-3 px-2 mb-8 mt-2 text-primary">
          <Orbit className="w-8 h-8 animate-[spin_10s_linear_infinite]" />
          <h1 className="text-xl font-bold font-sans tracking-wider text-white">OPENCLAW</h1>
        </div>
        
        <div className="flex-1 flex flex-col gap-2">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            const Icon = item.icon;
            
            return (
              <Link key={item.path} href={item.path} className={`
                flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group relative overflow-hidden
                ${isActive ? 'text-primary bg-primary/10 shadow-[inset_0_0_20px_rgba(6,182,212,0.1)] border border-primary/20' : 'text-muted-foreground hover:text-white hover:bg-white/5'}
              `}>
                <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'group-hover:text-white'}`} />
                <span className="font-medium">{item.label}</span>
                {isActive && (
                  <motion.div 
                    layoutId="activeTab" 
                    className="absolute left-0 w-1 h-full bg-primary"
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
              </Link>
            );
          })}
        </div>
        
        <div className="mt-auto px-4 py-4 border-t border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-fast shadow-[0_0_10px_rgba(34,197,94,0.6)]" />
            <span className="text-xs text-muted-foreground font-mono">SYSTEM ONLINE</span>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:pl-64 min-w-0 pb-20 md:pb-0 h-screen overflow-hidden relative">
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8 scroll-smooth">
          <AnimatePresence mode="wait">
            <motion.div
              key={location}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full flex flex-col"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 glass-panel border-t border-white/10 z-50 px-2 py-3 flex justify-between items-center safe-area-bottom">
        {navItems.map((item) => {
          const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
          const Icon = item.icon;
          
          return (
            <Link key={item.path} href={item.path} className={`
              flex flex-col items-center justify-center w-14 h-12 rounded-lg relative
              ${isActive ? 'text-primary' : 'text-muted-foreground'}
            `}>
              <Icon className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-medium">{item.label}</span>
              {isActive && (
                <motion.div 
                  layoutId="activeBottomTab" 
                  className="absolute -top-3 w-8 h-1 rounded-full bg-primary shadow-[0_0_8px_rgba(6,182,212,0.8)]"
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
