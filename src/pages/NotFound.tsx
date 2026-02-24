import { useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home, AlertTriangle } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="public-shell flex items-center justify-center p-6">
      <div className="public-card w-full max-w-lg p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
          <AlertTriangle className="h-7 w-7 text-amber-600" />
        </div>
        <h1 className="text-4xl font-semibold">404</h1>
        <p className="mt-2 text-muted-foreground">
          La pagina que buscas no existe o fue movida.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">
            <Home className="h-4 w-4" />
            Volver al inicio
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
