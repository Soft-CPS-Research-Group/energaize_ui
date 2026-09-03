import {
    type JSX,
    memo,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";
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
    mapConsumptionProductionToDTO,
    mapPricingDataToPricingDTO,
    mapBatteryDataToBatteryDTOMap,
    mapEVDataToEVDTOMap,
    mapChargerDataToChargerDTOMap,
    mapConsumptionProductionForBuildingLive,
    mapPricingForBuildingLive,
} from "../../../mappers/energy.model.dtoGraphic.mapper";
import {
    type TimeFilter,
    useEnergyData
} from "../../../hooks/useEnergyData";
import { useRealTimeData, communityHouses } from "../../../hooks/useRealTimeData";
import "./GraphicsView.css";
import type { EnergyCommunity } from "../../../models/energy.model.ts";
import {
    EquipmentType,
    type SelectedEquipment
} from "../../../models/energy.selectedEquipment";
import { useUI } from "../../../contexts/UIContext";


const MemoCardConsumption_Production =
    memo(CardConsumption_Production);

const MemoCardPricing =
    memo(CardPricing);

const MemoCardBattery =
    memo(CardBattery);

const MemoCardEV =
    memo(CardEV);

const MemoCardCharger =
    memo(CardCharger);

interface Props {
    onCommunityChange: (
        community: EnergyCommunity
    ) => void;

    selectedEquipment:
        | SelectedEquipment[]
        | null;

    setSelectedEquipment: (
        equipment: SelectedEquipment[]
    ) => void;
}

function GraphicsView({
                          onCommunityChange,
                          selectedEquipment,
                          setSelectedEquipment
                      }: Props) {

    const { activeCommunity } = useUI();
    const community = activeCommunity?.id || "";

    const [filter, setFilter] =
        useState<TimeFilter | null>({
            type: "minutes",
            minutes: 60
        });

    const [showDropdown, setShowDropdown] =
        useState(false);

    const [rangeFrom, setRangeFrom] =
        useState("");

    const [rangeUntil, setRangeUntil] =
        useState("");

    const dropdownRef =
        useRef<HTMLDivElement>(null);

    const houseDropdownRef =
        useRef<HTMLDivElement>(null);

    const [isLive, setIsLive] =
        useState(false);

    const [showHouseDropdown, setShowHouseDropdown] =
        useState(false);

    const [selectedExchanges, setSelectedExchanges] =
        useState<string[]>([]);

    const {
        data: realTimeData,
        isWaitingForLiveData
    } = useRealTimeData(
        selectedExchanges,
        isLive
    );

    const {
        community: communityData,
        loading,
        loadingMore
    } = useEnergyData(
        community,
        filter
    );

    const onCommunityChangeRef =
        useRef(onCommunityChange);

    const isWaitingLive =
        isLive &&
        (
            !realTimeData ||
            realTimeData.collections.length === 0
        );

    useEffect(() => {
        onCommunityChangeRef.current =
            onCommunityChange;
    }, [onCommunityChange]);

    useEffect(() => {
        if (isLive) {
            if (realTimeData) {
                onCommunityChangeRef.current(realTimeData);
            } else if (!isWaitingLive) {
                onCommunityChangeRef.current({ id: community, collections: [] });
            }
        } else {
            if (communityData) {
                onCommunityChangeRef.current(communityData);
            } else if (!loading) {
                onCommunityChangeRef.current({ id: community, collections: [] });
            }
        }
    }, [
        communityData,
        realTimeData,
        isLive,
        loading,
        isWaitingLive,
        community
    ]);

    useEffect(() => {
        function handleClickOutside(
            event: MouseEvent
        ) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(
                    event.target as Node
                )
            ) {
                setShowDropdown(false);
            }

            if (
                houseDropdownRef.current &&
                !houseDropdownRef.current.contains(
                    event.target as Node
                )
            ) {
                setShowHouseDropdown(false);
            }
        }

        document.addEventListener(
            "mousedown",
            handleClickOutside
        );

        return () => {
            document.removeEventListener(
                "mousedown",
                handleClickOutside
            );
        };
    }, []);

    const dataSource =
        isLive
            ? realTimeData
            : communityData;

    const mappingSource =
        dataSource;

    /*
     * Mappers incrementais.
     */
    const consumptionProductionMapperRef =
        useRef(
            createIncrementalConsumptionProductionMapper()
        );

    const pricingMapperRef =
        useRef(
            createIncrementalPricingMapper()
        );

    const buildingConsumptionMapperRef =
        useRef(
            createIncrementalSingleBuildingConsumptionProductionMapper()
        );

    const buildingPricingMapperRef =
        useRef(
            createIncrementalSingleBuildingPricingMapper()
        );

    const batteryMapperRef =
        useRef(
            createIncrementalBatteryMapper()
        );

    const evMapperRef =
        useRef(
            createIncrementalEVMapper()
        );

    const chargerMapperRef =
        useRef(
            createIncrementalChargerMapper()
        );

    useEffect(() => {
        consumptionProductionMapperRef.current =
            createIncrementalConsumptionProductionMapper();

        pricingMapperRef.current =
            createIncrementalPricingMapper();

        buildingConsumptionMapperRef.current =
            createIncrementalSingleBuildingConsumptionProductionMapper();

        buildingPricingMapperRef.current =
            createIncrementalSingleBuildingPricingMapper();

        batteryMapperRef.current =
            createIncrementalBatteryMapper();

        evMapperRef.current =
            createIncrementalEVMapper();

        chargerMapperRef.current =
            createIncrementalChargerMapper();
    }, [
        community,
        filter
    ]);

    /*
     * Remove equipamentos que já não
     * existem nos dados recebidos.
     */
    useEffect(() => {
        if (
            !dataSource ||
            !selectedEquipment ||
            selectedEquipment.length === 0
        ) {
            return;
        }

        const activeBuildingIds =
            dataSource.collections.map(
                collection => collection.id
            );

        const validEquipment =
            selectedEquipment.filter(
                equipment =>
                    activeBuildingIds.includes(
                        equipment.building
                    )
            );

        if (
            validEquipment.length !==
            selectedEquipment.length
        ) {
            setSelectedEquipment(
                validEquipment
            );
        }
    }, [
        dataSource,
        selectedEquipment,
        setSelectedEquipment
    ]);

    /*
     * Dados gerais.
     */
    const communityConsumptionProductionData =
        useMemo(() => {
            if (!mappingSource) {
                return [];
            }

            return isLive
                ? mapConsumptionProductionToDTO(
                    mappingSource
                )
                : consumptionProductionMapperRef.current(
                    mappingSource
                );
        }, [mappingSource, isLive]);

    const communityPricingData =
        useMemo(() => {
            if (!mappingSource) {
                return [];
            }

            return isLive
                ? mapPricingDataToPricingDTO(
                    mappingSource
                )
                : pricingMapperRef.current(
                    mappingSource
                );
        }, [mappingSource, isLive]);

    /*
     * Batteries
     */
    const batteryData =
        useMemo(() => {
            const map = new Map();

            if (
                !mappingSource ||
                !selectedEquipment
            ) {
                return map;
            }

            selectedEquipment.forEach(
                equipment => {
                    if (
                        equipment.type !==
                        EquipmentType.Battery
                    ) {
                        return;
                    }

                    map.set(
                        `${equipment.building}:${equipment.id}`,
                        isLive
                            ? mapBatteryDataToBatteryDTOMap(
                                mappingSource,
                                equipment.building,
                                equipment.id
                            )
                            : batteryMapperRef.current(
                                mappingSource,
                                equipment.building,
                                equipment.id
                            )
                    );
                }
            );

            return map;
        }, [
            mappingSource,
            selectedEquipment,
            isLive
        ]);

    /*
     * Electric Vehicles
     */
    const evData =
        useMemo(() => {
            const map = new Map();

            if (
                !mappingSource ||
                !selectedEquipment
            ) {
                return map;
            }

            selectedEquipment.forEach(
                equipment => {
                    if (
                        equipment.type !==
                        EquipmentType.ElectricVehicle
                    ) {
                        return;
                    }

                    map.set(
                        `${equipment.building}:${equipment.id}`,
                        isLive
                            ? mapEVDataToEVDTOMap(
                                mappingSource,
                                equipment.building,
                                equipment.id
                            )
                            : evMapperRef.current(
                                mappingSource,
                                equipment.building,
                                equipment.id
                            )
                    );
                }
            );

            return map;
        }, [
            mappingSource,
            selectedEquipment,
            isLive
        ]);

    /*
     * Chargers
     */
    const chargerData =
        useMemo(() => {
            const map = new Map();

            if (
                !mappingSource ||
                !selectedEquipment
            ) {
                return map;
            }

            selectedEquipment.forEach(
                equipment => {
                    if (
                        equipment.type !==
                        EquipmentType.Chargers
                    ) {
                        return;
                    }

                    map.set(
                        `${equipment.building}:${equipment.id}`,
                        isLive
                            ? mapChargerDataToChargerDTOMap(
                                mappingSource,
                                equipment.building,
                                equipment.id
                            )
                            : chargerMapperRef.current(
                                mappingSource,
                                equipment.building,
                                equipment.id
                            )
                    );
                }
            );

            return map;
        }, [
            mappingSource,
            selectedEquipment,
            isLive
        ]);

    /*
     * Dados específicos de Buildings.
     */
    const buildingData =
        useMemo(() => {
            const map = new Map<
                string,
                {
                    consumption: any[];
                    pricing: any[];
                }
            >();

            if (
                !mappingSource ||
                !selectedEquipment
            ) {
                return map;
            }

            selectedEquipment.forEach(
                equipment => {
                    if (
                        equipment.type !==
                        EquipmentType.Building
                    ) {
                        return;
                    }

                    const building =
                        mappingSource.collections.find(
                            item =>
                                item.id ===
                                equipment.building
                        );

                    if (!building) {
                        return;
                    }

                    map.set(
                        equipment.building,
                        {
                            consumption:
                                isLive
                                    ? mapConsumptionProductionForBuildingLive(
                                        mappingSource,
                                        equipment.building
                                    )
                                    : buildingConsumptionMapperRef.current(
                                        mappingSource,
                                        equipment.building
                                    ),

                            pricing:
                                isLive
                                    ? mapPricingForBuildingLive(
                                        mappingSource,
                                        equipment.building
                                    )
                                    : buildingPricingMapperRef.current(
                                        mappingSource,
                                        equipment.building
                                    )
                        }
                    );
                }
            );

            return map;
        }, [
            mappingSource,
            selectedEquipment,
            isLive
        ]);

    const handleQuickSearch = (
        minutes: number
    ) => {
        setShowDropdown(false);
        setIsLive(false);
        setSelectedExchanges([]);

        setFilter(
            filter?.type === "minutes" &&
            filter.minutes === minutes
                ? null
                : {
                    type: "minutes",
                    minutes
                }
        );
    };

    const handleApplyRange = () => {
        if (
            !rangeFrom ||
            !rangeUntil
        ) {
            return;
        }

        setShowDropdown(false);
        setIsLive(false);
        setSelectedExchanges([]);

        setFilter({
            type: "range",
            from_ts: rangeFrom,
            until_ts: rangeUntil
        });
    };

    const handleSelectHouse = (
        exchange: string
    ) => {
        setSelectedExchanges(prev => {
            const isSelected =
                prev.includes(exchange);

            const next =
                isSelected
                    ? prev.filter(
                        item =>
                            item !== exchange
                    )
                    : [
                        ...prev,
                        exchange
                    ];

            if (next.length > 0) {
                setIsLive(true);
                setFilter(null);
            } else {
                setIsLive(false);
            }

            return next;
        });
    };

    const hasData =
        communityConsumptionProductionData.length > 0 ||
        communityPricingData.length > 0;

    const showingEquipment =
        !!(
            selectedEquipment &&
            selectedEquipment.length > 0
        );

    /*
     * Construção dos grupos de cards.
     */
    const equipmentGroups =
        useMemo(() => {
            const buildingMap =
                new Map<
                    string,
                    JSX.Element[]
                >();

            const addToBuilding = (
                building: string,
                element: JSX.Element
            ) => {
                if (
                    !buildingMap.has(
                        building
                    )
                ) {
                    buildingMap.set(
                        building,
                        []
                    );
                }

                buildingMap
                    .get(building)!
                    .push(element);
            };

            batteryData.forEach(
                (dtos, key) => {
                    const [
                        building,
                        id
                    ] = key.split(":");

                    addToBuilding(
                        building,
                        <div
                            className="card-container"
                            key={`bat-${key}`}
                        >
                            <MemoCardBattery
                                data={dtos}
                                title={`Battery: ${id}`}
                                isLive={isLive}
                            />
                        </div>
                    );
                }
            );

            evData.forEach(
                (dtos, key) => {
                    const [
                        building,
                        id
                    ] = key.split(":");

                    addToBuilding(
                        building,
                        <div
                            className="card-container"
                            key={`ev-${key}`}
                        >
                            <MemoCardEV
                                data={dtos}
                                title={`EV: ${id}`}
                                isLive={isLive}
                            />
                        </div>
                    );
                }
            );

            chargerData.forEach(
                (dtos, key) => {
                    const [
                        building,
                        id
                    ] = key.split(":");

                    addToBuilding(
                        building,
                        <div
                            className="card-container"
                            key={`ch-${key}`}
                        >
                            <MemoCardCharger
                                data={dtos}
                                title={`Charger: ${id}`}
                                isLive={isLive}
                            />
                        </div>
                    );
                }
            );

            buildingData.forEach(
                (dtos, building) => {
                    addToBuilding(
                        building,
                        <div
                            className="card-container"
                            key={`bcp-${building}`}
                        >
                            <MemoCardConsumption_Production
                                data={
                                    dtos.consumption
                                }
                                title={`Consumption vs Production: ${building}`}
                                isLive={isLive}
                            />
                        </div>
                    );

                    addToBuilding(
                        building,
                        <div
                            className="card-container"
                            key={`bpr-${building}`}
                        >
                            <MemoCardPricing
                                data={
                                    dtos.pricing
                                }
                                title={`Pricing: ${building}`}
                                isLive={isLive}
                            />
                        </div>
                    );
                }
            );

            return Array.from(
                buildingMap.entries()
            ).map(
                ([building, cards]) => (
                    <div
                        className="building-group"
                        key={building}
                    >
                        <div className="building-group-header">
                            <i className="bi bi-building" />
                            <span>
                                {building}
                            </span>
                        </div>

                        <div className="building-group-grid">
                            {cards}
                        </div>
                    </div>
                )
            );
        }, [
            batteryData,
            evData,
            chargerData,
            buildingData,
            isLive
        ]);

    /*
     * Cruzamento entre as casas disponiveis
     * para tempo real e as da comunidade
     */

    const [availableHouses, setAvailableHouses] = useState<string[]>([]);

    useEffect(() => {
        if (!communityData) return;

        const loadHouses = async () => {
            const houses = await communityHouses(communityData);
            setAvailableHouses(houses);
        };

        loadHouses();
    }, [communityData]);



    return (
        <div className="view-container">
            <h2>{community}</h2>

            <div className="filter-toolbar">
                <div className="filter-group">
                    {([
                        {
                            label: "1h",
                            mins: 60
                        },
                        {
                            label: "6h",
                            mins: 360
                        },
                        {
                            label: "1d",
                            mins: 1440
                        },
                        {
                            label: "7d",
                            mins: 10080
                        },
                        {
                            label: "30d",
                            mins: 43200
                        }
                    ] as const).map(
                        ({
                             label,
                             mins
                         }) => (
                            <button
                                key={mins}
                                className={
                                    filter?.type ===
                                    "minutes" &&
                                    filter.minutes ===
                                    mins
                                        ? "searchTimeButton-active"
                                        : "searchTimeButton"
                                }
                                onClick={() =>
                                    handleQuickSearch(
                                        mins
                                    )
                                }
                            >
                                {label}
                            </button>
                        )
                    )}

                    <div
                        className="live-control-group"
                        ref={
                            houseDropdownRef
                        }
                    >
                        <button
                            className={`live-button ${
                                isLive
                                    ? "active"
                                    : ""
                            }`}
                            onClick={() =>
                                setShowHouseDropdown(
                                    !showHouseDropdown
                                )
                            }
                        >
                            <span className="live-indicator" />

                            {isLive &&
                            selectedExchanges.length >
                            0
                                ? `LIVE (${selectedExchanges.length})`
                                : "GO LIVE"}
                        </button>

                        {showHouseDropdown && (
                            <div className="live-dropdown fade-in">
                                <div className="live-dropdown-header">
                                    Select Buildings
                                </div>

                                {availableHouses.length > 0 ? (
                                    availableHouses.map(house => (
                                        <div
                                            key={house}
                                            className={`live-dropdown-item ${
                                                selectedExchanges.includes(house)
                                                    ? "selected"
                                                    : ""
                                            }`}
                                            onClick={() => handleSelectHouse(house)}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedExchanges.includes(house)}
                                                readOnly
                                            />

                                            <span>{house}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="live-dropdown-empty">
                                        No buildings available
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div
                        className="dropdown-container"
                        ref={dropdownRef}
                    >
                        <button
                            className={`searchTimeButton custom-btn ${
                                showDropdown
                                    ? "active"
                                    : ""
                            }`}
                            onClick={() =>
                                setShowDropdown(
                                    !showDropdown
                                )
                            }
                        >
                            Custom Range ▾
                        </button>

                        {showDropdown && (
                            <div className="dropdown-list-content fade-in">
                                <div className="dropdown-field">
                                    <label>
                                        Initial Date
                                    </label>

                                    <input
                                        type="datetime-local"
                                        value={
                                            rangeFrom
                                        }
                                        onChange={e =>
                                            setRangeFrom(
                                                e.target.value
                                            )
                                        }
                                    />
                                </div>

                                <div className="dropdown-field">
                                    <label>
                                        End Date
                                    </label>

                                    <input
                                        type="datetime-local"
                                        value={
                                            rangeUntil
                                        }
                                        onChange={e =>
                                            setRangeUntil(
                                                e.target.value
                                            )
                                        }
                                    />
                                </div>

                                <button
                                    className="btn-apply-range"
                                    onClick={
                                        handleApplyRange
                                    }
                                >
                                    Apply Range
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {loadingMore && (
                    <div className="loading-more-indicator">
                        <span>
                            Loading more data…
                        </span>
                    </div>
                )}
            </div>

            <div className="graph-container">
                {loading || isWaitingForLiveData ? (
                    <div className="loader-wrapper">
                        <div className="spinner" />

                        <span>
                            {isWaitingForLiveData
                                ? "Connecting to Live Stream..."
                                : "Processing Historical Data..."}
                        </span>
                    </div>
                ) : (
                    <>
                        <div
                            style={{
                                display:
                                    showingEquipment
                                        ? "none"
                                        : "contents"
                            }}
                        >
                            {hasData ? (
                                <>
                                    <div className="card-container">
                                        <MemoCardConsumption_Production
                                            data={
                                                communityConsumptionProductionData
                                            }
                                            title="Consumption vs Production"
                                            isLive={
                                                isLive
                                            }
                                        />
                                    </div>

                                    <div className="card-container">
                                        <MemoCardPricing
                                            data={
                                                communityPricingData
                                            }
                                            title="Pricing History"
                                            isLive={
                                                isLive
                                            }
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="overlay-image">
                                    <img
                                        src="/assets/info/data_not_found.png"
                                        alt="No data found"
                                    />
                                </div>
                            )}
                        </div>

                        <div
                            style={{
                                display:
                                    showingEquipment
                                        ? "contents"
                                        : "none"
                            }}
                        >
                            {equipmentGroups}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default GraphicsView;