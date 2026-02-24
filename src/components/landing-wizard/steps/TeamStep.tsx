import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, GripVertical, User, Edit2, Check, X } from 'lucide-react';
import { LandingTeamMember } from '@/hooks/useLandingWizard';
import { cn } from '@/lib/utils';

interface TeamStepProps {
  team: LandingTeamMember[];
  primaryColor: string;
  onAdd: (member: Omit<LandingTeamMember, 'id' | 'workshop_id'>) => void;
  onUpdate: (member: Partial<LandingTeamMember> & { id: string }) => void;
  onDelete: (id: string) => void;
}

export function TeamStep({ team, primaryColor, onAdd, onUpdate, onDelete }: TeamStepProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    photo_url: '',
  });

  const handleAdd = () => {
    if (!formData.name) return;
    
    onAdd({
      name: formData.name,
      role: formData.role || null,
      photo_url: formData.photo_url || null,
      profile_id: null,
      show_on_landing: true,
      sort_order: team.length,
    });
    
    setFormData({ name: '', role: '', photo_url: '' });
    setIsAdding(false);
  };

  const handleEdit = (member: LandingTeamMember) => {
    setEditingId(member.id);
    setFormData({
      name: member.name,
      role: member.role || '',
      photo_url: member.photo_url || '',
    });
  };

  const handleSaveEdit = (id: string) => {
    onUpdate({
      id,
      name: formData.name,
      role: formData.role || null,
      photo_url: formData.photo_url || null,
    });
    setEditingId(null);
    setFormData({ name: '', role: '', photo_url: '' });
  };

  const toggleVisibility = (member: LandingTeamMember) => {
    onUpdate({ id: member.id, show_on_landing: !member.show_on_landing });
  };

  const visibleTeam = team.filter(m => m.show_on_landing);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Form */}
      <div className="space-y-6">
        <div className="card-premium p-6">
          <h2 className="text-2xl font-semibold mb-2">Equipo</h2>
          <p className="text-muted-foreground">
            Presenta a los profesionales que atenderán a tus clientes
          </p>
        </div>

        {/* Team list */}
        <div className="card-premium p-4 space-y-3">
          {team.map((member) => (
            <Card 
              key={member.id} 
              className={cn(
                "p-4 transition-all bg-background/80",
                editingId === member.id && "ring-2 ring-primary",
                !member.show_on_landing && "opacity-60"
              )}
            >
              {editingId === member.id ? (
                <div className="space-y-3">
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Nombre *"
                  />
                  <Input
                    value={formData.role}
                    onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                    placeholder="Cargo/Rol (ej: Mecánico Jefe)"
                  />
                  <Input
                    value={formData.photo_url}
                    onChange={(e) => setFormData(prev => ({ ...prev, photo_url: e.target.value }))}
                    placeholder="URL de foto (opcional)"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      <X className="w-4 h-4 mr-1" /> Cancelar
                    </Button>
                    <Button size="sm" onClick={() => handleSaveEdit(member.id)}>
                      <Check className="w-4 h-4 mr-1" /> Guardar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                  {member.photo_url ? (
                    <img src={member.photo_url} alt={member.name} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <User className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="font-medium">{member.name}</div>
                    {member.role && (
                      <div className="text-sm text-muted-foreground">{member.role}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`show-${member.id}`} className="text-xs text-muted-foreground">
                      Mostrar
                    </Label>
                    <Switch
                      id={`show-${member.id}`}
                      checked={member.show_on_landing}
                      onCheckedChange={() => toggleVisibility(member)}
                    />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(member)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(member.id)} className="text-destructive">
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
                placeholder="Nombre *"
                autoFocus
              />
              <Input
                value={formData.role}
                onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                placeholder="Cargo/Rol (ej: Mecánico Jefe)"
              />
              <Input
                value={formData.photo_url}
                onChange={(e) => setFormData(prev => ({ ...prev, photo_url: e.target.value }))}
                placeholder="URL de foto (opcional)"
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
            Agregar Miembro
          </Button>
        )}
      </div>

      {/* Preview */}
      <div className="lg:sticky lg:top-4">
        <div className="section-title mb-3">Vista previa</div>
        <Card className="overflow-hidden">
          <div className="p-4 border-b" style={{ backgroundColor: `${primaryColor}10` }}>
            <h3 className="font-semibold" style={{ color: primaryColor }}>Nuestro Equipo</h3>
          </div>
          <div className="p-4">
            {visibleTeam.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Agrega miembros y activa "Mostrar" para verlos aquí
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {visibleTeam.map((member) => (
                  <div key={member.id} className="text-center">
                    {member.photo_url ? (
                      <img 
                        src={member.photo_url} 
                        alt={member.name}
                        className="w-20 h-20 rounded-full object-cover mx-auto mb-2 ring-2 ring-offset-2 ring-primary"
                      />
                    ) : (
                      <div 
                        className="w-20 h-20 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-2xl font-bold"
                        style={{ backgroundColor: primaryColor }}
                      >
                        {member.name.charAt(0)}
                      </div>
                    )}
                    <div className="font-medium text-sm">{member.name}</div>
                    {member.role && (
                      <div className="text-xs text-muted-foreground">{member.role}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
