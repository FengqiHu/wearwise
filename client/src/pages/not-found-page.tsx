import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto mt-20 max-w-2xl">
      <Card className="space-y-4 p-8 text-center">
        <h1 className="text-5xl font-semibold text-charcoal">Page not found</h1>
        <p className="text-sm text-dim">The page you are looking for does not exist.</p>
        <div>
          <Button onClick={() => navigate("/")}>Back to home</Button>
        </div>
      </Card>
    </div>
  );
}
