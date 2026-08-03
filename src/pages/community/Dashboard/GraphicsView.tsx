import { type JSX, memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import CardConsumption_Production from "../../../components/graphics/GraphicCard/Community/CardConsuption_Production";
import CardPricing from "../../../components/graphics/GraphicCard/Community/CardPricing";
import CardBattery from "../../../components/graphics/GraphicCard/Building/BatteryCard";
import CardEV from "../../../components/graphics/GraphicCard/Building/CardEV";
import CardCharger from "../../../components/graphics/GraphicCard/Building/CardCharger";
import {
    createIncrementalConsumptionProductionMapper,
    createIncrementalPricingMapper,
    createIncrementalSingleBuildingConsumptionProductionMapper,
    createIncrementalSingleBuildingPricingMapper,
    createIncrementalBatteryMapper,
    createIncrementalEVMapper,
    createIncrementalChargerMapper,
} from "../../../mappers/energy.model.dtoGraphic.mapper";
import { type TimeFilter, useEnergyData } from "../../../hooks/useEnergyData";
import { useRealTimeData } from "../../../hooks/useRealTimeData";
import "./GraphicsView.css";
import type { EnergyCommunity } from "../../../models/energy.model.ts";
import { EquipmentType, type SelectedEquipment } from "../../../models/energy.selectedEquipment";

const AVAILABLE_HOUSES = [
    { label: "R-H-01", exchange: "percepta_live_data_R-H-01" },
    { label: "R-H-02", exchange: "percepta_live_data_R-H-02" },
    { label: "R-H-03", exchange: "percepta_live_data_R-H-03" },
    { label: "R-H-04", exchange: "percepta_live_data_R-H-04" },
    { label: "São Mamede", exchange: "percepta_live_data_SaoMamede" },
    { label: "i-charging headquarters", exchange: "percepta_live_data_i-charging headquarters 3Phase" },
];

const MemoCardConsumption_Production = memo(CardConsumption_Production);
const MemoCardPricing = memo(CardPricing);
const MemoCardBattery = memo(CardBattery);
const MemoCardEV = memo(CardEV);
const MemoCardCharger = memo(CardCharger);

function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        if (delayMs <= 0) {
            setDebounced(value);
            return;
        }
        const handle = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(handle);
    }, [value, delayMs]);
    return debounced;
}

interface Props {
    onCommunityChange: (community: EnergyCommunity) => void;
    selectedEquipment: SelectedEquipment[] | null;
    setSelectedEquipment: (equipment: SelectedEquipment[]) => void;
}

function GraphicsView({ onCommunityChange, selectedEquipment, setSelectedEquipment}: Props) {
    const community = localStorage.getItem("community") || "";

    const [filter, setFilter] = useState<TimeFilter | null>({ type: "minutes", minutes: 60 });
    const [showDropdown, setShowDropdown] = useState(false);
    const [rangeFrom, setRangeFrom] = useState("");
    const [rangeUntil, setRangeUntil] = useState("");
    const dropdownRef = useRef<HTMLDivElement>(null);
    const houseDropdownRef = useRef<HTMLDivElement>(null);

    const [isLive, setIsLive] = useState(false);
    const [showHouseDropdown, setShowHouseDropdown] = useState(false);
    const [selectedExchanges, setSelectedExchanges] = useState<string[]>([]);

    const { data: realTimeData } = useRealTimeData(selectedExchanges, isLive);

    const { community: communityData, loading, loadingMore } = useEnergyData(community, filter);

    const deferredCommunityData = useDeferredValue(communityData);
    const deferredSelectedEquipment = useDeferredValue(selectedEquipment);

    const onCommunityChangeRef = useRef(onCommunityChange);
    const isWaitingLive = isLive && (!realTimeData || realTimeData.collections.length === 0);
    useEffect(() => { onCommunityChangeRef.current = onCommunityChange; });

    useEffect(() => {
        if (isLive && realTimeData) {
            onCommunityChangeRef.current(realTimeData);
        } else if (!isLive && communityData) {
            onCommunityChangeRef.current(communityData);
        }
    }, [communityData, realTimeData, isLive]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setShowDropdown(false);
            if (houseDropdownRef.current && !houseDropdownRef.current.contains(event.target as Node)) setShowHouseDropdown(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const dataSource = isLive ? realTimeData : deferredCommunityData;

    const mappingSource = useDebouncedValue(dataSource, isLive ? 0 : 300);

    // Mappers com memória própria — só processam itens novos desde a última chamada
    // (ver energy.model.dtoGraphic.mapper.ts). Recriados sempre que a comunidade ou
    // o filtro de tempo mudam, para não arrastar cache antiga.
    const consumptionProductionMapperRef = useRef(createIncrementalConsumptionProductionMapper());
    const pricingMapperRef = useRef(createIncrementalPricingMapper());
    const buildingConsumptionMapperRef = useRef(createIncrementalSingleBuildingConsumptionProductionMapper());
    const buildingPricingMapperRef = useRef(createIncrementalSingleBuildingPricingMapper());
    const batteryMapperRef = useRef(createIncrementalBatteryMapper());
    const evMapperRef = useRef(createIncrementalEVMapper());
    const chargerMapperRef = useRef(createIncrementalChargerMapper());

    useEffect(() => {
        consumptionProductionMapperRef.current = createIncrementalConsumptionProductionMapper();
        pricingMapperRef.current = createIncrementalPricingMapper();
        buildingConsumptionMapperRef.current = createIncrementalSingleBuildingConsumptionProductionMapper();
        buildingPricingMapperRef.current = createIncrementalSingleBuildingPricingMapper();
        batteryMapperRef.current = createIncrementalBatteryMapper();
        evMapperRef.current = createIncrementalEVMapper();
        chargerMapperRef.current = createIncrementalChargerMapper();
    }, [community, filter]);

    useEffect(() => {
        if (!dataSource || !selectedEquipment || selectedEquipment.length === 0) return;

        const activeBuildingIds = dataSource.collections.map(col => col.id);

        const validEquipment = selectedEquipment.filter(eq =>
            activeBuildingIds.includes(eq.building)
        );

        if (validEquipment.length !== selectedEquipment.length) {
            setSelectedEquipment(validEquipment);
        }
    }, [dataSource, selectedEquipment, setSelectedEquipment]);

    const communityConsumptionProductionData = useMemo(() => {
        return mappingSource ? consumptionProductionMapperRef.current(mappingSource) : [];
    }, [mappingSource]);

    const communityPricingData = useMemo(() => {
        return mappingSource ? pricingMapperRef.current(mappingSource) : [];
    }, [mappingSource]);

    const batteryData = useMemo(() => {
        const map = new Map();
        if (!mappingSource || !deferredSelectedEquipment) return map;
        deferredSelectedEquipment.forEach((eq) => {
            if (eq.type === EquipmentType.Battery) {
                map.set(`${eq.building}:${eq.id}`, batteryMapperRef.current(mappingSource, eq.building, eq.id));
            }
        });
        return map;
    }, [mappingSource, deferredSelectedEquipment]);

    const evData = useMemo(() => {
        const map = new Map();
        if (!mappingSource || !deferredSelectedEquipment) return map;
        deferredSelectedEquipment.forEach((eq) => {
            if (eq.type === EquipmentType.ElectricVehicle) {
                map.set(`${eq.building}:${eq.id}`, evMapperRef.current(mappingSource, eq.building, eq.id));
            }
        });
        return map;
    }, [mappingSource, deferredSelectedEquipment]);

    const chargerData = useMemo(() => {
        const map = new Map();
        if (!mappingSource || !deferredSelectedEquipment) return map;
        deferredSelectedEquipment.forEach((eq) => {
            if (eq.type === EquipmentType.Chargers) {
                map.set(`${eq.building}:${eq.id}`, chargerMapperRef.current(mappingSource, eq.building, eq.id));
            }
        });
        return map;
    }, [mappingSource, deferredSelectedEquipment]);

    const buildingData = useMemo(() => {
        const map = new Map<string, { consumption: any[]; pricing: any[] }>();
        if (!mappingSource || !deferredSelectedEquipment) return map;
        deferredSelectedEquipment.forEach((eq) => {
            if (eq.type === EquipmentType.Building) {
                const building = mappingSource.collections.find((b) => b.id === eq.building);
                if (!building) return;
                map.set(eq.building, {
                    consumption: buildingConsumptionMapperRef.current(mappingSource, eq.building),
                    pricing: buildingPricingMapperRef.current(mappingSource, eq.building),
                });
            }
        });
        return map;
    }, [mappingSource, deferredSelectedEquipment]);

    const handleQuickSearch = (minutes: number) => {
        setShowDropdown(false);
        setIsLive(false);
        setSelectedExchanges([]);
        setFilter(filter?.type === "minutes" && filter.minutes === minutes ? null : { type: "minutes", minutes });
    };

    const handleApplyRange = () => {
        if (!rangeFrom || !rangeUntil) return;
        setShowDropdown(false);
        setIsLive(false);
        setSelectedExchanges([]);
        setFilter({ type: "range", from_ts: rangeFrom, until_ts: rangeUntil });
    };

    const handleSelectHouse = (exchange: string) => {
        setSelectedExchanges((prev) => {
            const isSelected = prev.includes(exchange);
            const next = isSelected ? prev.filter(e => e !== exchange) : [...prev, exchange];

            if (next.length > 0) {
                setIsLive(true);
                setFilter(null);
            } else {
                setIsLive(false);
            }
            return next;
        });
    };

    const hasData = communityConsumptionProductionData.length > 0 || communityPricingData.length > 0;
    const isStale = mappingSource !== dataSource;
    const showingEquipment = !!(selectedEquipment && selectedEquipment.length > 0);

    const equipmentGroups = useMemo(() => {
        const buildingMap = new Map<string, JSX.Element[]>();
        const addToBuilding = (building: string, element: JSX.Element) => {
            if (!buildingMap.has(building)) buildingMap.set(building, []);
            buildingMap.get(building)!.push(element);
        };

        batteryData.forEach((dtos, key) => {
            const [b, id] = key.split(":");
            addToBuilding(b, <div className="card-container" key={`bat-${key}`}><MemoCardBattery data={dtos} title={`Battery: ${id}`} isLive={isLive} /></div>);
        });

        evData.forEach((dtos, key) => {
            const [b, id] = key.split(":");
            addToBuilding(b, <div className="card-container" key={`ev-${key}`}><MemoCardEV data={dtos} title={`EV: ${id}`} isLive={isLive} /></div>);
        });

        chargerData.forEach((dtos, key) => {
            const [b, id] = key.split(":");
            addToBuilding(b, <div className="card-container" key={`ch-${key}`}><MemoCardCharger data={dtos} title={`Charger: ${id}`} isLive={isLive} /></div>);
        });

        buildingData.forEach((dtos, building) => {
            addToBuilding(building, <div className="card-container" key={`bcp-${building}`}><MemoCardConsumption_Production data={dtos.consumption} title={`Consumption vs Production: ${building}`} isLive={isLive} /></div>);
            addToBuilding(building, <div className="card-container" key={`bpr-${building}`}><MemoCardPricing data={dtos.pricing} title={`Pricing: ${building}`} isLive={isLive} /></div>);
        });

        return Array.from(buildingMap.entries()).map(([building, cards]) => (
            <div className="building-group" key={building}>
                <div className="building-group-header">
                    <i className="bi bi-building" />
                    <span>{building}</span>
                </div>
                <div className="building-group-grid">{cards}</div>
            </div>
        ));
    }, [batteryData, evData, chargerData, buildingData, isLive]);

    return (
        <div className="view-container">
            <h2>{community}</h2>

            <div className="filter-toolbar">
                <div className="filter-group">
                    {([
                        { label: "1h", mins: 60 },
                        { label: "6h", mins: 360 },
                        { label: "1d", mins: 1440 },
                        { label: "7d", mins: 10080 },
                        { label: "30d", mins: 43200 },
                    ] as const).map(({ label, mins }) => (
                        <button
                            key={mins}
                            className={filter?.type === "minutes" && filter.minutes === mins ? "searchTimeButton-active" : "searchTimeButton"}
                            onClick={() => handleQuickSearch(mins)}
                        >
                            {label}
                        </button>
                    ))}

                    <div className="live-control-group" ref={houseDropdownRef}>
                        <button className={`live-button ${isLive ? "active" : ""}`} onClick={() => setShowHouseDropdown(!showHouseDropdown)}>
                            <span className="live-indicator" />
                            {isLive && selectedExchanges.length > 0 ? `LIVE (${selectedExchanges.length})` : "GO LIVE"}
                        </button>

                        {showHouseDropdown && (
                            <div className="live-dropdown fade-in">
                                <div className="live-dropdown-header">Select Buildings</div>
                                {AVAILABLE_HOUSES.map((house) => (
                                    <div
                                        key={house.exchange}
                                        className={`live-dropdown-item ${selectedExchanges.includes(house.exchange) ? "selected" : ""}`}
                                        onClick={() => handleSelectHouse(house.exchange)}
                                    >
                                        <input type="checkbox" checked={selectedExchanges.includes(house.exchange)} readOnly />
                                        <span>{house.label}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="dropdown-container" ref={dropdownRef}>
                        <button className={`searchTimeButton custom-btn ${showDropdown ? "active" : ""}`} onClick={() => setShowDropdown(!showDropdown)}>
                            Custom Range ▾
                        </button>
                        {showDropdown && (
                            <div className="dropdown-list-content fade-in">
                                <div className="dropdown-field">
                                    <label>Initial Date</label>
                                    <input type="datetime-local" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
                                </div>
                                <div className="dropdown-field">
                                    <label>End Date</label>
                                    <input type="datetime-local" value={rangeUntil} onChange={(e) => setRangeUntil(e.target.value)} />
                                </div>
                                <button className="btn-apply-range" onClick={handleApplyRange}>Apply Range</button>
                            </div>
                        )}
                    </div>
                </div>

                {loadingMore && <div className="loading-more-indicator"><span>A carregar mais dados…</span></div>}
            </div>

            <div className="graph-container" style={{ opacity: isStale ? 0.6 : 1 }}>
                {loading || isWaitingLive ? (
                    <div className="loader-wrapper">
                        <div className="spinner"></div>
                        <span>
                            {isWaitingLive
                                ? "Connecting to Live Stream..."
                                : "Processing Historical Data..."}
                        </span>
                    </div>
                ) : (
                    <>
                        <div style={{ display: showingEquipment ? "none" : "contents" }}>
                            {hasData ? (
                                <>
                                    <div className="card-container">
                                        <MemoCardConsumption_Production data={communityConsumptionProductionData} title="Consumption vs Production" isLive={isLive} />
                                    </div>
                                    <div className="card-container">
                                        <MemoCardPricing data={communityPricingData} title="Pricing History" isLive={isLive} />
                                    </div>
                                </>
                            ) : (
                                <div className="overlay-image"><img src="/assets/info/data_not_found.png" alt="No data found" /></div>
                            )}
                        </div>

                        <div style={{ display: showingEquipment ? "contents" : "none" }}>
                            {equipmentGroups}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default GraphicsView;