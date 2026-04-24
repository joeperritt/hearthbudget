import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import LoginMfaChallenge from "./pages/LoginMfaChallenge.tsx";
import Signup from "./pages/Signup.tsx";
import ForgotPassword from "./pages/ForgotPassword.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import NotFound from "./pages/NotFound.tsx";
import AdminTestAuth from "./pages/AdminTestAuth.tsx";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";
import { RecoveryCodeBanner } from "@/components/auth/RecoveryCodeBanner";

const queryClient = new QueryClient();

function AuthGate() {
  const { user, loading, pendingMfa } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center animate-pulse">
          <span className="text-primary-foreground font-display text-lg font-bold">K</span>
        </div>
      </div>
    );
  }

  // MFA gate: user has password session but a verified TOTP factor and AAL=aal1.
  // Block ALL authenticated routes until they pass the challenge.
  if (user && pendingMfa) {
    return (
      <Routes>
        <Route path="*" element={<LoginMfaChallenge />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {user ? (
        <>
          <Route path="/admin/test-auth" element={<AdminTestAuth />} />
          <Route path="/" element={
            <>
              <VerifyEmailBanner />
              <RecoveryCodeBanner />
              <Index />
            </>
          } />
          <Route path="*" element={<NotFound />} />
        </>
      ) : (
        <Route path="*" element={<Login />} />
      )}
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthGate />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
