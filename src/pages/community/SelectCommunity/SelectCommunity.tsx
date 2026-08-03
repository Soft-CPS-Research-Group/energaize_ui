import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCommunitiesData } from "../../../api/communityDataApi";
import logo from "../../assets/logoSoftCPS.png";
import "./SelectCommunity.css";

function CommunityCard({
                           name,
                           selected,
                           onSelect,
                       }: {
    name: string;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            className={`sc-card ${selected ? "sc-card--selected" : ""}`}
            onClick={onSelect}
        >
            <div className="sc-card__header">
                <div className="sc-card__icon">
                    {/* ÍCONE DE COMUNIDADE (Users) */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                </div>
                <div className="sc-card__title-wrap">
                    <span className="sc-card__name">{name}</span>
                </div>
                {/* O CÍRCULO "CERTO" FOI REMOVIDO DAQUI */}
            </div>
        </button>
    );
}

export default function SelectCommunity() {
    const navigate = useNavigate();
    const [communities, setCommunities] = useState<string[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        getCommunitiesData()
            .then((data) => {
                setCommunities(data);
                setIsLoading(false);
            })
            .catch((err) => {
                console.error("Error fetching communities:", err);
                setIsLoading(false);
            });
    }, []);

    const filtered = communities.filter(c =>
        c.toLowerCase().includes(search.toLowerCase())
    );

    const handleEnter = () => {
        if (!selected) return;
        localStorage.setItem("community", selected);
        navigate("/dashboard");
    };

    return (
        <div className="sc-page">
            <div className="sc-panel-left">
                <div className="sc-panel-left__bg" />
                <div className="sc-panel-left__overlay" />
                <div className="sc-panel-left__content">
                    <h1 className="sc-panel-left__title">
                        Select your <span>Energy Community</span>
                    </h1>
                    <p className="sc-panel-left__sub">
                        Choose one of the registered communities to access the management dashboard.
                    </p>
                </div>
            </div>

            <div className="sc-panel-right">
                <div className="sc-top">
                    <div className="sc-logo-wrap">
                        <img src={logo} height={28} alt="SoftCPS Logo" />
                        <span className="sc-logo-name">SoftCPS</span>
                    </div>
                    <h2 className="sc-heading">Communities</h2>
                    <p className="sc-sub">Select a community to continue.</p>
                    <input
                        type="text"
                        className="sc-search"
                        placeholder="Search communities..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                <div className="sc-list">
                    {isLoading ? (
                        <div className="sc-empty">Loading communities...</div>
                    ) : filtered.length === 0 ? (
                        <div className="sc-empty">No communities found.</div>
                    ) : (
                        filtered.map((name) => (
                            <CommunityCard
                                key={name}
                                name={name}
                                selected={selected === name}
                                onSelect={() => setSelected(name)}
                            />
                        ))
                    )}
                </div>

                <div className="sc-footer">
                    <button
                        type="button"
                        className="sc-enter-btn"
                        onClick={handleEnter}
                        disabled={!selected}
                    >
                        {selected ? `Enter — ${selected}` : "Select a community"}
                    </button>
                </div>
            </div>
        </div>
    );
}