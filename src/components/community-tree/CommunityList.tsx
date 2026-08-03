import { useState } from "react";
import type { Building, EnergyCommunity } from '../../models/energy.model.ts';
import { getBuildingEquipmentNames } from '../../models/energy.model';
import { EquipmentType, type SelectedEquipment } from "../../models/energy.selectedEquipment";
import './CommunityList.css';

interface CommunityListProps {
    selectedItems: SelectedEquipment[];
    onSelectionChange: (items: SelectedEquipment[]) => void;
    community: EnergyCommunity | null;
}

function CommunityList({ selectedItems, onSelectionChange, community }: CommunityListProps) {
    const [expandedIds, setExpandedIds] = useState<string[]>([]);

    if (!community) {
        return <div className="community-container">Loading data..</div>;
    }

    const toggleExpanded = (id: string) => {
        setExpandedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const isItemSelected = (id: string) => selectedItems.some(item => (item.id+"-"+item.building) === id);

    const handleToggle = (id: string, type: EquipmentType, buildingId: string) => {
        const isSelected = isItemSelected(id+"-"+buildingId);
        if (isSelected) {
            onSelectionChange(selectedItems.filter(item => (item.id+"-"+item.building) !== (id+"-"+buildingId)));
        } else {
            onSelectionChange([...selectedItems, { id, type, building: buildingId }]);
        }
    };

    return (
        <div className="community-container">
            <div className="title-wrapper">
                <h2 className="community-title">{community.id}</h2>
                <div className="title-underline"></div>
            </div>

            <ul className="community-list">
                {community.collections.map((building: Building) => {
                    const { batteries, evs, chargers} = getBuildingEquipmentNames(building);
                    const buildingExpanded = expandedIds.includes(building.id);
                    const hasEquipment = batteries.length > 0 || evs.length > 0 || chargers.length > 0;

                    return (
                        <li key={building.id}>
                            <div className="item-header">
                                {hasEquipment ? (
                                    <button className="expand-button" onClick={() => toggleExpanded(building.id)}>
                                        {buildingExpanded ? "−" : "+"}
                                    </button>
                                ) : <span className="no-children-spacer" />}
                                <label className="leaf-label building-label">
                                    <input
                                        type="checkbox"
                                        checked={isItemSelected(building.id + "-" + building.id)}
                                        onChange={() => handleToggle(building.id, EquipmentType.Building, building.id)}
                                    />
                                    <span className="item-name">{building.id}</span>
                                </label>
                            </div>

                            {buildingExpanded && (
                                <ul className="sub-list">
                                    {batteries.length > 0 && (
                                        <li>
                                            <div className="item-header">
                                                <button className="expand-button" onClick={() => toggleExpanded(`bat-${building.id}`)}>
                                                    {expandedIds.includes(`bat-${building.id}`) ? "−" : "+"}
                                                </button>
                                                <span className="item-name">Batteries</span>
                                            </div>
                                            {expandedIds.includes(`bat-${building.id}`) && (
                                                <ul className="sub-list">
                                                    {batteries.map(id => (
                                                        <li key={id} className="leaf-item">
                                                            <label className="leaf-label">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isItemSelected(id+"-"+building.id)}
                                                                    onChange={() => handleToggle(id, EquipmentType.Battery, building.id)}
                                                                />
                                                                <span className="item-name">{id}</span>
                                                            </label>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </li>
                                    )}

                                    {evs.length > 0 && (
                                        <li>
                                            <div className="item-header">
                                                <button className="expand-button" onClick={() => toggleExpanded(`ev-${building.id}`)}>
                                                    {expandedIds.includes(`ev-${building.id}`) ? "−" : "+"}
                                                </button>
                                                <span className="item-name">Electric Vehicles</span>
                                            </div>
                                            {expandedIds.includes(`ev-${building.id}`) && (
                                                <ul className="sub-list">
                                                    {evs.map(id => (
                                                        <li key={id} className="leaf-item">
                                                            <label className="leaf-label">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isItemSelected(id+"-"+building.id)}
                                                                    onChange={() => handleToggle(id, EquipmentType.ElectricVehicle, building.id)}
                                                                />
                                                                <span className="item-name">{id}</span>
                                                            </label>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </li>
                                    )}

                                    {chargers.length > 0 && (
                                        <li>
                                            <div className="item-header">
                                                <button className="expand-button" onClick={() => toggleExpanded(`charger-${building.id}`)}>
                                                    {expandedIds.includes(`charger-${building.id}`) ? "−" : "+"}
                                                </button>
                                                <span className="item-name">Electric Vehicle Chargers</span>
                                            </div>

                                            {expandedIds.includes(`charger-${building.id}`) && (
                                                <ul className="sub-list">
                                                    {chargers.map(id => (
                                                        <li key={id} className="leaf-item">
                                                            <label className="leaf-label">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isItemSelected(id + "-" + building.id)}
                                                                    onChange={() => handleToggle(id, EquipmentType.Chargers, building.id)}
                                                                />
                                                                <span className="item-name">{id}</span>
                                                            </label>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </li>
                                    )}
                                </ul>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

export default CommunityList;