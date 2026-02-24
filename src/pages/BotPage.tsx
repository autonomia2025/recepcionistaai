import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export default function BotPage() {
  return (
    <div className="page-shell page-stack">
      <PageHeader title="Bot IA" description="Configura tu asistente virtual" />
      <div className="grid gap-6">
        <Card>
          <CardHeader><CardTitle>Descripción del negocio</CardTitle></CardHeader>
          <CardContent>
            <Label>Describe tu negocio para que el bot pueda responder correctamente</Label>
            <Textarea placeholder="Ej: Somos un negocio especializado en..." className="mt-2" rows={4} />
            <Button className="mt-4">Guardar</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
