import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip,
    BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { Brain, Target, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

const COLORS = [
    '#8B5CF6', // Purple (agendar)
    '#0EA5E9', // Blue (consulta)
    '#F59E0B', // Amber (cotizacion)
    '#10B981', // Emerald (compra)
    '#EF4444', // Red (reclamo)
    '#64748B', // Slate (otro/saludo)
];

const INTENT_LABELS: Record<string, string> = {
    agendar_cita: 'Agendar Cita',
    cotizacion: 'Cotización',
    consulta: 'Consulta',
    compra: 'Compra',
    reclamo: 'Reclamo',
    seguimiento: 'Seguimiento',
    soporte: 'Soporte',
    saludo: 'Saludo',
    otro: 'Otro'
};

export const SuperAdminIntentMetrics = () => {
    const { data: intentData, isLoading } = useQuery({
        queryKey: ['admin-intent-metrics'],
        queryFn: async () => {
            const { data: contacts, error } = await supabase
                .from('contacts')
                .select('detected_intent, workshop_id, workshops(name)');

            if (error) throw error;

            // Aggregate by intent
            const intentCounts: Record<string, number> = {};
            const workshopIntentCounts: Record<string, Record<string, number>> = {};

            contacts?.forEach(contact => {
                const intent = contact.detected_intent || 'otro';
                const workshopName = contact.workshops?.name || 'Desconocido';

                intentCounts[intent] = (intentCounts[intent] || 0) + 1;

                if (!workshopIntentCounts[workshopName]) {
                    workshopIntentCounts[workshopName] = {};
                }
                workshopIntentCounts[workshopName][intent] = (workshopIntentCounts[workshopName][intent] || 0) + 1;
            });

            const pieData = Object.entries(intentCounts).map(([name, value]) => ({
                name: INTENT_LABELS[name] || name,
                value,
                key: name
            })).sort((a, b) => b.value - a.value);

            const barData = Object.entries(workshopIntentCounts).map(([name, intents]) => ({
                name,
                ...intents
            })).slice(0, 10); // Top 10 workshops

            return { pieData, barData, total: contacts?.length || 0 };
        }
    });

    if (isLoading) {
        return (
            <div className="grid gap-4 md:grid-cols-2">
                <Card className="h-[400px]">
                    <CardHeader>
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/2" />
                    </CardHeader>
                    <CardContent className="flex items-center justify-center">
                        <Skeleton className="h-64 w-64 rounded-full" />
                    </CardContent>
                </Card>
                <Card className="h-[400px]">
                    <CardHeader>
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/2" />
                    </CardHeader>
                    <CardContent>
                        <Skeleton className="h-64 w-full" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2">
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Target className="w-5 h-5 text-primary" />
                        <div>
                            <CardTitle>Distribución de Intenciones</CardTitle>
                            <CardDescription>Qué es lo que más piden los clientes globalmente</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={intentData?.pieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {intentData?.pieData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                                itemStyle={{ color: 'hsl(var(--foreground))' }}
                            />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Brain className="w-5 h-5 text-primary" />
                        <div>
                            <CardTitle>Análisis por Taller (Top 10)</CardTitle>
                            <CardDescription>Volumen de intenciones detectadas por cliente</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={intentData?.barData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} opacity={0.3} />
                            <XAxis type="number" hide />
                            <YAxis
                                dataKey="name"
                                type="category"
                                width={100}
                                fontSize={10}
                                tick={{ fill: 'currentColor', opacity: 0.7 }}
                            />
                            <Tooltip
                                cursor={{ fill: 'transparent' }}
                                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                            />
                            <Bar dataKey="agendar_cita" name="Agendar" stackId="a" fill={COLORS[0]} radius={[0, 0, 0, 0]} />
                            <Bar dataKey="consulta" name="Consulta" stackId="a" fill={COLORS[1]} />
                            <Bar dataKey="cotizacion" name="Cotización" stackId="a" fill={COLORS[2]} />
                            <Bar dataKey="compra" name="Compra" stackId="a" fill={COLORS[3]} />
                            <Bar dataKey="otro" name="Otros" stackId="a" fill={COLORS[5]} radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
    );
};
