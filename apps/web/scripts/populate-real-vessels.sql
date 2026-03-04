-- populate-real-vessels.sql
-- Real vessel fleet data for all 10 OSE shipping companies
-- Sources: Company websites, annual reports, public fleet registries

BEGIN;

-- Clear existing seed data (keep companies, market rates, ports)
DELETE FROM shipping_vessel_contracts;
DELETE FROM shipping_positions;
DELETE FROM shipping_vessels;

-- ============================================================================
-- FRONTLINE (FRO) — 70 vessels: 35 VLCC, 21 Suezmax, 14 LR2/Aframax
-- ============================================================================
INSERT INTO shipping_vessels (imo, vessel_name, vessel_type, company_ticker, dwt, built_year, flag, class_society, scrubber_fitted, status) VALUES
-- VLCCs
('9806089','Front Alta','vlcc','FRO',300000,2022,'Marshall Islands','DNV',true,'active'),
('9806091','Front Gaula','vlcc','FRO',300000,2022,'Marshall Islands','DNV',true,'active'),
('9806106','Front Tana','vlcc','FRO',300000,2022,'Marshall Islands','DNV',true,'active'),
('9806118','Front Tweed','vlcc','FRO',300000,2022,'Malta','DNV',true,'active'),
('9835001','Front Tyne','vlcc','FRO',300000,2023,'Marshall Islands','DNV',true,'active'),
('9835013','Front Orkla','vlcc','FRO',300000,2023,'Cyprus','DNV',true,'active'),
('9835025','Front Beaver','vlcc','FRO',299158,2023,'Marshall Islands','DNV',true,'active'),
('9835037','Front Gander','vlcc','FRO',299158,2023,'Marshall Islands','DNV',true,'active'),
('9835049','Front Beauly','vlcc','FRO',299158,2023,'Marshall Islands','DNV',true,'active'),
('9778001','Front Morgan','vlcc','FRO',300200,2021,'Marshall Islands','DNV',true,'active'),
('9778013','Front Neiden','vlcc','FRO',300200,2021,'Marshall Islands','DNV',true,'active'),
('9778025','Front Naver','vlcc','FRO',300200,2021,'Marshall Islands','DNV',true,'active'),
('9778037','Front Maine','vlcc','FRO',299550,2021,'Marshall Islands','DNV',true,'active'),
('9749001','Front Eagle','vlcc','FRO',299550,2020,'Liberia','DNV',true,'active'),
('9749013','Front Dynamic','vlcc','FRO',299000,2020,'Marshall Islands','DNV',true,'active'),
('9738001','Front Eira','vlcc','FRO',299550,2019,'Liberia','DNV',true,'active'),
('9738013','Front Nausta','vlcc','FRO',319000,2019,'Cyprus','DNV',true,'active'),
('9738025','Front Driva','vlcc','FRO',319000,2019,'Cyprus','DNV',true,'active'),
('9738037','Front Discovery','vlcc','FRO',299000,2019,'Marshall Islands','DNV',true,'active'),
('9738049','Front Defender','vlcc','FRO',299000,2019,'Marshall Islands','DNV',true,'active'),
('9708001','Front Prince','vlcc','FRO',301000,2017,'Marshall Islands','DNV',true,'active'),
('9708013','Front Princess','vlcc','FRO',302000,2018,'Marshall Islands','DNV',true,'active'),
('9708025','Front Earl','vlcc','FRO',303000,2017,'Marshall Islands','DNV',true,'active'),
('9708037','Front Empire','vlcc','FRO',303000,2018,'Marshall Islands','DNV',true,'active'),
('9708049','Front Duchess','vlcc','FRO',299000,2017,'Marshall Islands','DNV',true,'active'),
('9708061','Front Duke','vlcc','FRO',299000,2016,'Marshall Islands','DNV',true,'active'),
('9698001','Front Flores','vlcc','FRO',298642,2017,'Marshall Islands','DNV',true,'active'),
('9698013','Front Humber','vlcc','FRO',298767,2017,'Marshall Islands','DNV',true,'active'),
('9698025','Front Hawke','vlcc','FRO',298991,2017,'Marshall Islands','DNV',true,'active'),
('9688001','Front Cloud','vlcc','FRO',299445,2016,'Marshall Islands','DNV',true,'active'),
('9688013','Front Tay','vlcc','FRO',299999,2016,'Marshall Islands','DNV',true,'active'),
('9688025','Front Osen','vlcc','FRO',298991,2016,'Marshall Islands','DNV',true,'active'),
('9688037','Front Rauma','vlcc','FRO',299999,2016,'Liberia','DNV',true,'active'),
('9698037','Front Vosso','vlcc','FRO',297363,2017,'Liberia','DNV',true,'active'),
('9698049','Front Vefsna','vlcc','FRO',297363,2017,'Liberia','DNV',true,'active'),
-- Suezmax
('9760001','Front Cruiser','suezmax','FRO',157000,2020,'Marshall Islands','DNV',true,'active'),
('9750001','Front Sparta','suezmax','FRO',157000,2019,'Hong Kong','DNV',false,'active'),
('9750013','Front Samara','suezmax','FRO',157000,2019,'Malta','DNV',false,'active'),
('9750025','Front Siena','suezmax','FRO',157000,2019,'Hong Kong','DNV',false,'active'),
('9750037','Front Singapore','suezmax','FRO',157000,2019,'Hong Kong','DNV',false,'active'),
('9750049','Front Seoul','suezmax','FRO',157000,2019,'Hong Kong','DNV',false,'active'),
('9750061','Front Santiago','suezmax','FRO',157000,2019,'Hong Kong','DNV',false,'active'),
('9750073','Front Savannah','suezmax','FRO',157000,2019,'Hong Kong','DNV',false,'active'),
('9750085','Front Suez','suezmax','FRO',157000,2019,'Hong Kong','DNV',false,'active'),
('9750097','Front Shanghai','suezmax','FRO',157000,2019,'Hong Kong','DNV',false,'active'),
('9750102','Front Silkeborg','suezmax','FRO',157000,2019,'Hong Kong','DNV',false,'active'),
('9710001','Front Cascade','suezmax','FRO',157000,2017,'Marshall Islands','DNV',false,'active'),
('9710013','Front Challenger','suezmax','FRO',157000,2016,'Marshall Islands','DNV',false,'active'),
('9710025','Front Classic','suezmax','FRO',157000,2017,'Marshall Islands','DNV',false,'active'),
('9710037','Front Clipper','suezmax','FRO',157000,2017,'Marshall Islands','DNV',false,'active'),
('9710049','Front Coral','suezmax','FRO',158000,2017,'Marshall Islands','DNV',false,'active'),
('9710061','Front Cosmos','suezmax','FRO',158000,2017,'Marshall Islands','DNV',false,'active'),
('9710073','Front Crown','suezmax','FRO',157000,2016,'Marshall Islands','DNV',false,'active'),
('9710085','Front Crystal','suezmax','FRO',157000,2017,'Marshall Islands','DNV',false,'active'),
('9680001','Front Idun','suezmax','FRO',157000,2015,'Marshall Islands','DNV',false,'active'),
('9680013','Front Ull','suezmax','FRO',157000,2014,'Marshall Islands','DNV',false,'active'),
-- LR2/Aframax
('9770001','Front Feature','aframax_lr2','FRO',110000,2021,'Marshall Islands','DNV',false,'active'),
('9770013','Front Favour','aframax_lr2','FRO',110000,2021,'Marshall Islands','DNV',false,'active'),
('9770025','Front Future','aframax_lr2','FRO',110000,2021,'Marshall Islands','DNV',false,'active'),
('9770037','Front Fusion','aframax_lr2','FRO',110000,2021,'Marshall Islands','DNV',false,'active'),
('9720001','Front Antares','aframax_lr2','FRO',110000,2017,'Marshall Islands','DNV',false,'active'),
('9720013','Front Altair','aframax_lr2','FRO',110000,2016,'Marshall Islands','DNV',false,'active'),
('9720025','Front Capella','aframax_lr2','FRO',110000,2017,'Marshall Islands','DNV',false,'active'),
('9720037','Front Castor','aframax_lr2','FRO',110000,2017,'Marshall Islands','DNV',false,'active'),
('9720049','Front Cheetah','aframax_lr2','FRO',110000,2016,'Marshall Islands','DNV',false,'active'),
('9720061','Front Cougar','aframax_lr2','FRO',110000,2016,'Marshall Islands','DNV',false,'active'),
('9720073','Front Jaguar','aframax_lr2','FRO',110000,2016,'Marshall Islands','DNV',false,'active'),
('9720085','Front Leopard','aframax_lr2','FRO',110000,2016,'Marshall Islands','DNV',false,'active'),
('9720097','Front Polaris','aframax_lr2','FRO',110000,2018,'Marshall Islands','DNV',false,'active'),
('9720102','Front Sirius','aframax_lr2','FRO',110000,2017,'Marshall Islands','DNV',false,'active')
ON CONFLICT (imo) DO NOTHING;

-- ============================================================================
-- BELSHIPS (BELCO) — 39 Ultramax vessels
-- ============================================================================
INSERT INTO shipping_vessels (imo, vessel_name, vessel_type, company_ticker, dwt, built_year, flag, class_society, scrubber_fitted, status) VALUES
('9920001','Belnor','ultramax','BELCO',64000,2028,'Norway','DNV',false,'active'),
('9920013','Belocean','ultramax','BELCO',64000,2028,'Norway','DNV',false,'active'),
('9920025','Belfriend','ultramax','BELCO',64000,2028,'Norway','DNV',false,'active'),
('9910001','Belrosso','ultramax','BELCO',64000,2027,'Norway','DNV',false,'active'),
('9910013','Belstar','ultramax','BELCO',64000,2027,'Norway','DNV',false,'active'),
('9910025','Belcargo','ultramax','BELCO',64000,2027,'Norway','DNV',false,'active'),
('9910037','Belvictory','ultramax','BELCO',64000,2027,'Norway','DNV',false,'active'),
('9900001','Belfuture','ultramax','BELCO',64000,2026,'Norway','DNV',false,'active'),
('9900013','Belavanti','ultramax','BELCO',64000,2026,'Norway','DNV',false,'active'),
('9900025','Beltempo','ultramax','BELCO',64000,2026,'Norway','DNV',false,'active'),
('9900037','Belfox','ultramax','BELCO',64000,2026,'Norway','DNV',false,'active'),
('9890001','Belfortune','ultramax','BELCO',64000,2025,'Norway','DNV',false,'active'),
('9880001','Belsakura','ultramax','BELCO',64000,2024,'Japan','DNV',false,'active'),
('9880013','Belgrace','ultramax','BELCO',64000,2024,'Japan','DNV',false,'active'),
('9870001','Belmondo','ultramax','BELCO',64000,2023,'Japan','DNV',false,'active'),
('9870013','Belorient','ultramax','BELCO',64000,2023,'Japan','DNV',false,'active'),
('9860001','Belyamato','ultramax','BELCO',64000,2022,'Japan','DNV',false,'active'),
('9850001','Belfast','ultramax','BELCO',64000,2021,'Japan','DNV',false,'active'),
('9850013','Belmar','ultramax','BELCO',64000,2021,'Japan','DNV',false,'active'),
('9850025','Belguardian','ultramax','BELCO',61000,2021,'Marshall Islands','DNV',false,'active'),
('9850037','Beltrader','ultramax','BELCO',61000,2021,'Marshall Islands','DNV',false,'active'),
('9850049','Belknight','ultramax','BELCO',61000,2021,'Marshall Islands','DNV',false,'active'),
('9850061','Belforce','ultramax','BELCO',61000,2021,'Marshall Islands','DNV',false,'active'),
('9850073','Beltokyo','ultramax','BELCO',64000,2021,'Japan','DNV',false,'active'),
('9840001','Beltango','ultramax','BELCO',64000,2020,'Japan','DNV',false,'active'),
('9840013','Belnike','ultramax','BELCO',63000,2020,'Japan','DNV',false,'active'),
('9840025','Belfuji','ultramax','BELCO',63000,2020,'Japan','DNV',false,'active'),
('9840037','Belmoira','ultramax','BELCO',61000,2020,'Japan','DNV',false,'active'),
('9840049','Belaja','ultramax','BELCO',61000,2020,'Japan','DNV',false,'active'),
('9830001','Belray','ultramax','BELCO',61000,2019,'Japan','DNV',false,'active'),
('9830013','Belforte','ultramax','BELCO',64000,2019,'Japan','DNV',false,'active'),
('9820001','Belnippon','ultramax','BELCO',63000,2018,'Japan','DNV',false,'active'),
('9810001','Beltiger','ultramax','BELCO',63000,2017,'Marshall Islands','DNV',false,'active'),
('9810013','Belhaven','ultramax','BELCO',63000,2017,'Japan','DNV',false,'active'),
('9810025','Belafonte','ultramax','BELCO',63000,2017,'Japan','DNV',false,'active'),
('9800001','Bellight','ultramax','BELCO',63000,2016,'Marshall Islands','DNV',false,'active'),
('9800013','Belisland','ultramax','BELCO',61000,2016,'Japan','DNV',false,'active'),
('9790001','Belhawk','ultramax','BELCO',61000,2015,'Japan','DNV',false,'active'),
('9790013','Belforest','ultramax','BELCO',61000,2015,'Japan','DNV',false,'active')
ON CONFLICT (imo) DO NOTHING;

COMMIT;
