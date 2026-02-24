import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, GripVertical, Clock, DollarSign, Edit2, Check, X } from 'lucide-react';
import { LandingService } from '@/hooks/useLandingWizard';
import { cn } from '@/lib/utils';

interface ServicesStepProps {
  services: LandingService[];
  primaryColor: string;
  onAdd: (service: Omit<LandingService, 'id' | 'workshop_id'>) => void;
  onUpdate: (service: Partial<LandingService> & { id: string }) => void;
  onDelete: (id: string) => void;
}

export function ServicesStep({ services, primaryColor, onAdd, onUpdate, onDelete }: ServicesStepProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    duration_minutes: 60,
    price: '',
    description: '',
  });

  const handleAdd = () => {
    if (!formData.name) return;
    
    onAdd({
      name: formData.name,
      duration_minutes: formData.duration_minutes,
      price: formData.price ? parseFloat(formData.price) : null,
      description: formData.description || null,
      sort_order: services.length,
      is_active: true,
    });
    
    setFormData({ name: '', duration_minutes: 60, price: '', description: '' });
    setIsAdding(false);
  };

  const handleEdit = (service: LandingService) => {
    setEditingId(service.id);
    setFormData({
      name: service.name,
      duration_minutes: service.duration_minutes,
      price: service.price?.toString() || '',
      description: service.description || '',
    });
  };

  const handleSaveEdit = (id: string) => {
    onUpdate({
      id,
      name: formData.name,
      duration_minutes: formData.duration_minutes,
      price: formData.price ? parseFloat(formData.price) : null,
      description: formData.description || null,
    });
    setEditingId(null);
    setFormData({ name: '', duration_minutes: 60, price: '', description: '' });
  };

  const formatPrice = (price: number | null) => {
    if (!price) return 'Consultar';
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(price);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Form */}
      <div className="space-y-6">
        <div className="card-premium p-6">
          <h2 className="text-2xl font-semibold mb-2">Servicios</h2>
          <p className="text-muted-foreground">
            Agrega los servicios que ofreces para que los clientes puedan elegir
          </p>
        </div>

        {/* Service list */}
        <div className="card-premium p-4 space-y-3">
          {services.map((service) => (
            <Card 
              key={service.id} 
              className={cn(
                "p-4 transition-all bg-background/80",
                editingId === service.id && "ring-2 ring-primary"
              )}
            >
              {editingId === service.id ? (
                <div className="space-y-3">
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Nombre del servicio"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Duración (min)</Label>
                      <Input
                        type="number"
                        value={formData.duration_minutes}
                        onChange={(e) => setFormData(prev => ({ ...prev, duration_minutes: parseInt(e.target.value) || 60 }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Precio (CLP)</Label>
                      <Input
                        type="number"
                        value={formData.price}
                        onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Descripción corta (opcional)"
                    rows={2}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      <X className="w-4 h-4 mr-1" /> Cancelar
                    </Button>
                    <Button size="sm" onClick={() => handleSaveEdit(service.id)}>
                      <Check className="w-4 h-4 mr-1" /> Guardar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                  <div className="flex-1">
                    <div className="font-medium">{service.name}</div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {service.duration_minutes} min
                      </span>
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-3 h-3" /> {formatPrice(service.price)}
                      </span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(service)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(service.id)} className="text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>

        {/* Add form */}
        {isAdding ? (
          <Card className="p-4 border-dashed bg-background/80">
            <div className="space-y-3">
              <Input
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nombre del servicio *"
                autoFocus
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Duración (min)</Label>
                  <Input
                    type="number"
                    value={formData.duration_minutes}
                    onChange={(e) => setFormData(prev => ({ ...prev, duration_minutes: parseInt(e.target.value) || 60 }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Precio (CLP)</Label>
                  <Input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                    placeholder="Opcional"
                  />
                </div>
              </div>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Descripción corta (opcional)"
                rows={2}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setIsAdding(false)}>Cancelar</Button>
                <Button onClick={handleAdd} disabled={!formData.name}>Agregar</Button>
              </div>
            </div>
          </Card>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setIsAdding(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Agregar Servicio
          </Button>
        )}
      </div>

      {/* Preview */}
      <div className="lg:sticky lg:top-4">
        <div className="section-title mb-3">Vista previa</div>
        <Card className="overflow-hidden">
          <div className="p-4 border-b" style={{ backgroundColor: `${primaryColor}10` }}>
            <h3 className="font-semibold" style={{ color: primaryColor }}>Nuestros Servicios</h3>
          </div>
          <div className="p-4 space-y-3">
            {services.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Agrega servicios para ver la vista previa
              </p>
            ) : (
              services.map((service) => (
                <div 
                  key={service.id}
                  className="p-4 rounded-lg border hover:border-primary/50 transition-colors cursor-pointer"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{service.name}</div>
                      {service.description && (
                        <p className="text-sm text-muted-foreground">{service.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-semibold" style={{ color: primaryColor }}>
                        {formatPrice(service.price)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {service.duration_minutes} min
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
