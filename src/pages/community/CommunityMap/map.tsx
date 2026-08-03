import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map.css";
import {
    Map as MapIcon,
    LayoutList,
    MapPinIcon,
    Info,
    Battery as BatteryIcon,
    Car,
    Home,
    Sun,
    Clock
} from "lucide-react";
import ReactFlow, {
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    type Node,
    type Edge,
    type NodeChange,
    Position
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { EnergyCommunity, Building } from "../../../models/energy.model.ts";
import type * as GeoJSON from "geojson";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const DefaultIcon = L.icon({
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34]
});
L.Marker.prototype.options.icon = DefaultIcon;

const DEFAULT_CENTER = { lat: 39.557, lng: -8.963 };
const REC_RADIUS_DEG = 0.00018;

function randomCoordInRadius(centerLat: number, centerLng: number, maxRadius = REC_RADIUS_DEG) {
    const minRadius = maxRadius * 0.3;
    const r = minRadius + Math.random() * (maxRadius - minRadius);
    const angle = Math.random() * 2 * Math.PI;
    return {
        lat: centerLat + r * Math.cos(angle),
        lng: centerLng + r * Math.sin(angle),
    };
}

function distanceDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    return Math.sqrt(Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2));
}

function formatPower(value: number | undefined | null): string {
    if (value === undefined || value === null) return "N/A";
    if (value < 0.01) return "0 kW";
    return `${Number(value).toFixed(2)} kW`;
}

function formatDate(dateStr: string | undefined | null): string {
    if (!dateStr || dateStr.trim() === "" || dateStr === "undefined" || dateStr === "null") return "N/A";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "Data inválida";
    return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function latestObs(building: Building) {
    return building.items[building.items.length - 1]?.observations;
}

function latestItem(building: Building) {
    return building.items[building.items.length - 1];
}

function getDataStatus(community: EnergyCommunity | null | undefined): { isLive: boolean; dateLabel: string } {
    if (!community) return { isLive: false, dateLabel: "No data" };

    let latestTs: Date | null = null;
    for (const building of community.collections) {
        const item = latestItem(building);
        if (item?.timestamp) {
            const d = new Date(item.timestamp);
            if (!isNaN(d.getTime()) && (!latestTs || d > latestTs)) latestTs = d;
        }
    }

    if (!latestTs) return { isLive: false, dateLabel: "No data" };

    const diffMin = (Date.now() - latestTs.getTime()) / 60000;
    const isLive = diffMin < 5;
    const dateLabel = isLive
        ? "Updated now"
        : `Data from ${latestTs.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;

    return { isLive, dateLabel };
}

function getThemeAccent(): string {
    return getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#18a56f";
}

interface Props {
    community?: EnergyCommunity | null;
}

export default function Map_buildings({ community }: Props) {
    const mapElRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markersRef = useRef<{ [key: string]: L.Marker }>({});
    const geoJsonLayerRef = useRef<L.GeoJSON | null>(null);
    const coordCacheRef = useRef<{ [id: string]: { lat: number; lng: number } }>({});
    const communityCircleRef = useRef<L.Circle | null>(null);
    const centerBuildingRef = useRef<{ lat: number; lng: number } | null>(null);

    const [viewMode, setViewMode] = useState<"mapa" | "outro">("mapa");
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const customPositionsRef = useRef<{ [nodeId: string]: { x: number; y: number } }>({});

    const [themeAccent, setThemeAccent] = useState(getThemeAccent());

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setThemeAccent(getThemeAccent());
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "style"]
        });

        return () => observer.disconnect();
    }, []);

    const handleNodesChange = useCallback((changes: NodeChange[]) => {
        changes.forEach((change) => {
            if (change.type === 'position' && change.dragging === false && change.position) {
                customPositionsRef.current[change.id] = change.position;
            }
        });
        onNodesChange(changes);
    }, [onNodesChange]);

    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const communityName = localStorage.getItem("community") || "Comunidade";

    const pontos = useMemo(() => {
        if (!community) return [];

        if (!centerBuildingRef.current) {
            centerBuildingRef.current = {
                lat: DEFAULT_CENTER.lat + (Math.random() - 0.5) * 0.02,
                lng: DEFAULT_CENTER.lng + (Math.random() - 0.5) * 0.02,
            };
        }

        const center = centerBuildingRef.current;

        return community.collections.map((building, idx) => {
            if (!coordCacheRef.current[building.id]) {
                if (idx === 0) {
                    coordCacheRef.current[building.id] = { lat: center.lat, lng: center.lng };
                } else {
                    coordCacheRef.current[building.id] = randomCoordInRadius(center.lat, center.lng);
                }
            }
            const { lat, lng } = coordCacheRef.current[building.id];
            const firstObs = latestObs(building);
            let tipo = "Building";
            if (firstObs) {
                const parts = [];
                if (firstObs.batteries?.length > 0) parts.push("Battery");
                if (firstObs.electric_vehicles?.length > 0) parts.push("EV");
                if (firstObs.charging_session?.length > 0) parts.push("Charger");
                if (firstObs.grid_meters?.length > 0) parts.push("Grid");
                if (firstObs.pv_panels?.length > 0) parts.push("PV");
                if (parts.length > 0) tipo = parts.join(" · ");
            }
            return { lat, lng, nome: building.id, tipo, raw: building, isCenter: idx === 0 };
        });
    }, [community]);

    const { isLive, dateLabel } = useMemo(() => getDataStatus(community), [community]);

    useEffect(() => {
        if (viewMode === "mapa" && mapRef.current) {
            setTimeout(() => mapRef.current?.invalidateSize(), 300);
        }
    }, [viewMode]);

    useEffect(() => {
        if (!community || viewMode !== "outro") return;

        const assetSpacing = 160;
        const buildingMargin = 120;
        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];
        const rootId = "root-community";
        let currentX = 0;

        const buildingsData = community.collections.map((building) => {
            const obs = latestObs(building);
            const assets = [
                ...(obs?.grid_meters.map(g => ({ ...g, _type: 'grid' })) || []),
                ...(obs?.batteries.map(b => ({ ...b, _type: 'battery' })) || []),
                ...(obs?.charging_session.map(c => ({ ...c, _type: 'charger' })) || []),
                ...(obs?.electric_vehicles.map(ev => ({ ...ev, _type: 'ev' })) || []),
                ...(obs?.pv_panels.map(pv => ({ ...pv, _type: 'pv' })) || [])
            ];
            const groupWidth = Math.max(200, assets.length * assetSpacing);
            const xPos = currentX;
            currentX += groupWidth + buildingMargin;
            return { building, assets, xPos, groupWidth };
        });

        const totalWidth = currentX - buildingMargin;
        newNodes.push({
            id: rootId,
            type: 'input',
            data: { label: communityName, type: 'community' },
            position: customPositionsRef.current[rootId] ?? { x: totalWidth / 2 - 100, y: 0 },
            className: 'node-community',
            sourcePosition: Position.Bottom,
        });

        buildingsData.forEach(({ building, assets, xPos, groupWidth }) => {
            const bNodeId = `node-b-${building.id}`;
            const buildingX = xPos + (groupWidth / 2) - 75;
            newNodes.push({
                id: bNodeId,
                data: { label: building.id, type: 'building', raw: building },
                position: customPositionsRef.current[bNodeId] ?? { x: buildingX, y: 180 },
                className: 'node-building',
                targetPosition: Position.Top,
                sourcePosition: Position.Bottom,
            });
            newEdges.push({
                id: `e-${rootId}-${bNodeId}`,
                source: rootId,
                target: bNodeId,
                animated: true,
                type: 'smoothstep',
                style: { stroke: themeAccent, strokeWidth: 2 }
            });

            const startAssetsX = xPos + (groupWidth / 2) - ((assets.length - 1) * assetSpacing / 2);
            assets.forEach((asset, aIdx) => {
                const type = asset._type;
                const aId = `${type}-${asset.id}`;
                const edgeColors: Record<string, string> = {
                    grid: '#64748b', battery: '#10b981',
                    charger: '#8b5cf6', ev: '#f59e0b', pv: '#eab308'
                };
                newNodes.push({
                    id: aId,
                    data: { label: asset.id, type, details: asset },
                    position: customPositionsRef.current[aId] ?? { x: startAssetsX + (aIdx * assetSpacing) - 65, y: 380 },
                    className: `node-asset ${type}`,
                    targetPosition: Position.Top,
                });
                newEdges.push({
                    id: `e-${bNodeId}-${aId}`,
                    source: bNodeId,
                    target: aId,
                    type: 'smoothstep',
                    style: { stroke: edgeColors[type] || '#fff' }
                });
            });
        });

        setNodes(newNodes);
        setEdges(newEdges);
    }, [community, viewMode, communityName, themeAccent]);

    useEffect(() => {
        if (!mapElRef.current || mapRef.current) return;
        const map = L.map(mapElRef.current, { zoomControl: false, maxZoom: 22 }).setView([0, 0], 2);

        L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { maxNativeZoom: 19, maxZoom: 22 }
        ).addTo(map);

        L.tileLayer(
            'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
            { maxNativeZoom: 19, maxZoom: 22 }
        ).addTo(map);

        mapRef.current = map;
    }, []);

    useEffect(() => {
        if (!mapRef.current) return;

        if (geoJsonLayerRef.current) {
            geoJsonLayerRef.current.remove();
            geoJsonLayerRef.current = null;
        }
        markersRef.current = {};

        if (pontos.length === 0) return;

        const featureCollection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
            type: "FeatureCollection",
            features: pontos.map(p => ({
                type: "Feature",
                properties: { nome: p.nome, tipo: p.tipo },
                geometry: {
                    type: "Point",
                    coordinates: [p.lng, p.lat]
                }
            }))
        };

        geoJsonLayerRef.current = L.geoJSON(featureCollection, {
            pointToLayer: (feature: { properties: { nome: string | number; tipo: any; }; }, latlng: any) => {
                const marker = L.marker(latlng);
                marker.bindPopup(
                    `<b>${feature.properties?.nome}</b><br/>${feature.properties?.tipo}`
                );
                markersRef.current[feature.properties?.nome] = marker;
                return marker;
            }
        }).addTo(mapRef.current);
    }, [pontos]);

    useEffect(() => {
        if (!mapRef.current || pontos.length === 0) return;

        if (communityCircleRef.current) {
            communityCircleRef.current.remove();
            communityCircleRef.current = null;
        }

        const center = centerBuildingRef.current!;

        const maxDistDeg = pontos.reduce((max, p) => {
            return Math.max(max, distanceDeg(center, { lat: p.lat, lng: p.lng }));
        }, 0);

        const radiusMeters = (maxDistDeg * 111000) * 1.2 + 30;

        communityCircleRef.current = L.circle([center.lat, center.lng], {
            radius: radiusMeters,
            color: themeAccent,
            weight: 2,
            opacity: 0.9,
            fillColor: themeAccent,
            fillOpacity: 0.07,
            dashArray: "6 4",
        }).addTo(mapRef.current);

        mapRef.current.fitBounds(communityCircleRef.current.getBounds(), {
            padding: [40, 40],
            maxZoom: 18
        });

    }, [pontos, themeAccent]);

    const toPercent = (v: number | null | undefined): string =>
        v != null ? (v * 100).toFixed(0) : 'N/A';

    return (
        <div className="layout-ptd">
            <aside className="sidebar-ptd">
                <div className="sidebar-header">
                    <div className="header-top">
                        <div className="header-text">
                            <h2>{communityName}</h2>
                            <span className="count-label">{pontos.length} Buildings</span>
                        </div>
                        <div className="view-toggle">
                            <button className={viewMode === "mapa" ? "active" : ""} onClick={() => setViewMode("mapa")}>
                                <MapIcon size={18} />
                            </button>
                            <button className={viewMode === "outro" ? "active" : ""} onClick={() => setViewMode("outro")}>
                                <LayoutList size={18} />
                            </button>
                        </div>
                    </div>
                    <div className="data-status-bar">
                        {isLive ? (
                            <span className="badge badge-live">
                                <span className="live-dot" />
                                Live
                            </span>
                        ) : (
                            <span className="badge badge-hist">
                                <Clock size={11} />
                                Historic
                            </span>
                        )}
                        <span className="status-date">{dateLabel}</span>
                    </div>
                </div>

                <div className="lista-casas">
                    {pontos.map((p, idx) => (
                        <div key={idx} className="card-casa">
                            <div className="card-info">
                                <span className="nome">{p.nome}</span>
                                <span className="sub">{p.tipo}</span>
                            </div>
                            <button className="btn-locate" onClick={() => {
                                setViewMode("mapa");
                                setTimeout(() => {
                                    mapRef.current?.invalidateSize();
                                    mapRef.current?.flyTo([p.lat, p.lng], 20);
                                    markersRef.current[p.nome]?.openPopup();
                                }, 250);
                            }}><MapPinIcon size={16} /></button>
                        </div>
                    ))}
                </div>
            </aside>

            <main className="main-content-area">
                <div className="map-area" style={{ display: viewMode === "mapa" ? "block" : "none", height: "100%" }}>
                    <div ref={mapElRef} className="leaflet-map-element" />
                </div>

                {viewMode === "outro" && (
                    <div className="topology-container">
                        <div className="topology-canvas">
                            <ReactFlow
                                nodes={nodes}
                                edges={edges}
                                onNodesChange={handleNodesChange}
                                onEdgesChange={onEdgesChange}
                                onNodeClick={(_: any, node: any) => setSelectedNode(node)}
                                nodesConnectable={false}
                                fitView
                            >
                                <Background color="#334155" gap={20} />
                                <Controls />
                            </ReactFlow>
                        </div>

                        {selectedNode && (
                            <aside className="topology-side-panel">
                                <div className="panel-header">
                                    <h3><Info size={16} /> Asset Details</h3>
                                    <button className="close-btn" onClick={() => setSelectedNode(null)}>×</button>
                                </div>
                                <div className="panel-body">
                                    <div className="detail-card">
                                        <span className="label">Unique ID</span>
                                        <span className="value">
                                            {selectedNode.data.type === 'community'
                                                ? community?.id
                                                : (selectedNode.data.type === 'building'
                                                    ? selectedNode.data.raw?.id
                                                    : selectedNode.data.details?.id)}
                                        </span>
                                    </div>

                                    {selectedNode.data.type === 'community' && (
                                        <div className="dynamic-props">
                                            <h4><MapIcon size={14} /> Energy Community Overview</h4>
                                            <div className="prop-group">
                                                <p>Total Buildings: <strong>{community?.collections.length}</strong></p>
                                                <p>Total Assets: <strong>{
                                                    community?.collections.reduce((acc, b) => {
                                                        const obs = latestObs(b);
                                                        return acc + (obs?.batteries.length || 0)
                                                            + (obs?.electric_vehicles.length || 0)
                                                            + (obs?.charging_session.length || 0)
                                                            + (obs?.grid_meters.length || 0)
                                                            + (obs?.pv_panels.length || 0);
                                                    }, 0)
                                                }</strong></p>
                                                <hr />
                                                <p>Total Solar Gen: <strong>{
                                                    community?.collections.reduce((acc, b) =>
                                                        acc + (Number(latestObs(b)?.solar_generation) || 0), 0).toFixed(2)
                                                } W</strong></p>
                                                <p>Total Grid Import: <strong>{
                                                    community?.collections.reduce((acc, b) =>
                                                        acc + (latestItem(b)?.community_snapshot?.energy_in_total || 0), 0).toFixed(4)
                                                } W</strong></p>
                                                <p>Total Grid Export: <strong>{
                                                    community?.collections.reduce((acc, b) =>
                                                        acc + (latestItem(b)?.community_snapshot?.energy_out_total || 0), 0).toFixed(4)
                                                } W</strong></p>
                                            </div>
                                        </div>
                                    )}

                                    {selectedNode.data.type === 'building' && (() => {
                                        const obs = latestObs(selectedNode.data.raw);
                                        const snapshot = latestItem(selectedNode.data.raw)?.community_snapshot;
                                        return (
                                            <div className="dynamic-props">
                                                <h4><Home size={14} /> Building Overview</h4>
                                                <div className="prop-group">
                                                    <p>Solar Generation: <strong>{Number(obs?.solar_generation ?? 0).toFixed(4)} W</strong></p>
                                                    <p>Non-Shiftable Load: <strong>{Number(obs?.non_shiftable_load ?? 0).toFixed(4)} W</strong></p>
                                                    <p>Energy Price: <strong>{Number(obs?.energy_price ?? 0).toFixed(4)} €/kWh</strong></p>
                                                    <hr />
                                                    <p>Community Energy In: <strong>{Number(snapshot?.energy_in_total ?? 0).toFixed(4)} W</strong></p>
                                                    <p>Community Energy Out: <strong>{Number(snapshot?.energy_out_total ?? 0).toFixed(4)} W</strong></p>
                                                    <hr />
                                                    <p>Net Balance:
                                                        <strong style={{ color: (Number(obs?.solar_generation ?? 0) - Number(obs?.non_shiftable_load ?? 0)) >= 0 ? '#10b981' : '#ef4444' }}>
                                                            {(Number(obs?.solar_generation ?? 0) - Number(obs?.non_shiftable_load ?? 0)).toFixed(4)} W
                                                        </strong>
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {selectedNode.data.type === 'battery' && (
                                        <div className="dynamic-props">
                                            <h4><BatteryIcon size={14} /> Battery System</h4>
                                            <p>State of Charge (SoC): <strong>{toPercent(selectedNode.data.details?.soc)}%</strong></p>
                                            <p>Energy In: <strong>{selectedNode.data.details?.energyIn ?? 0} W</strong></p>
                                            <p>Energy Out: <strong>{selectedNode.data.details?.energyOut ?? 0} W</strong></p>
                                        </div>
                                    )}

                                    {selectedNode.data.type === 'ev' && (() => {
                                        const details = selectedNode.data.details;
                                        return (
                                            <div className="dynamic-props">
                                                <h4><Car size={14} /> Electric Vehicle</h4>
                                                <p>Current SoC: <strong>{toPercent(details?.SoC)}%</strong></p>
                                                <p>Connected Charger: <strong>{details?.charger ?? 'None'}</strong></p>
                                                <hr />
                                                <h5 style={{ marginTop: '10px', fontSize: '0.9em', color: '#94a3b8' }}>Predictions</h5>
                                                <p>Arrival: <strong>{formatDate(details?.estimated_time_at_arrival)}</strong> ({toPercent(details?.estimated_soc_at_arrival)}%)</p>
                                                <p>Departure: <strong>{formatDate(details?.estimated_time_at_departure)}</strong> ({toPercent(details?.estimated_soc_at_departure)}%)</p>
                                            </div>
                                        );
                                    })()}

                                    {selectedNode.data.type === 'pv' && (
                                        <div className="dynamic-props">
                                            <h4><Sun size={14} /> PV Panel</h4>
                                            <p>Energy: <strong>{Number(selectedNode.data.details?.energy ?? 0).toFixed(4)} W</strong></p>
                                        </div>
                                    )}

                                    {selectedNode.data.type === 'grid' && (
                                        <div className="dynamic-props">
                                            <h4><LayoutList size={14} /> Grid Connection</h4>
                                            <p>Import (Energy In): <strong>{selectedNode.data.details?.energyIn ?? 0} W</strong></p>
                                            <p>Export (Energy Out): <strong>{selectedNode.data.details?.energyOut ?? 0} W</strong></p>
                                        </div>
                                    )}

                                    {selectedNode.data.type === 'charger' && (
                                        <div className="dynamic-props">
                                            <h4><BatteryIcon size={14} /> EV Charger</h4>
                                            <p>Active Power: <strong>{formatPower(selectedNode.data.details?.power)}</strong></p>
                                            <p>Assigned Vehicle: <strong>{selectedNode.data.details?.electric_vehicle || 'None'}</strong></p>
                                        </div>
                                    )}
                                </div>
                            </aside>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}