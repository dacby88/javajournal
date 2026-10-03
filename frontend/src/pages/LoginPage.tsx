import { useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { LoginForm } from '@/components/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Coffee, UserPlus } from 'lucide-react';

export function LoginPage() {
  const { isAuthenticated, isLoading, needsSetup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get the intended destination from location state, or default to dashboard
  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/';

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      // Already logged in, redirect to the intended destination
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, from]);

  const handleSuccess = () => {
    navigate(from, { replace: true });
  };

  // Show loading spinner while checking auth status
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="spinner w-10 h-10 border-3 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // If setup is needed, show a special setup prompt instead of login
  if (needsSetup) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Coffee className="h-6 w-6 text-primary" />
            </div>
            <span className="text-2xl font-semibold">Java Journal</span>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Welcome!</CardTitle>
              <CardDescription>
                Get started by creating your account
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This appears to be your first time here. Create an account to start tracking your trades.
              </p>
              <Button asChild className="w-full">
                <Link to="/setup">
                  <UserPlus className="mr-2 h-4 w-4" />
                  Create Account
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
            <Coffee className="h-6 w-6 text-primary" />
          </div>
          <span className="text-2xl font-semibold">Java Journal</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome Back</CardTitle>
            <CardDescription>
              Sign in to your account to access your trading journal
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm onSuccess={handleSuccess} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
